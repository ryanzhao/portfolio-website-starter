export const MAX_MODEL_BYTES = 50 * 1024 ** 2;
const invalid = () => new Error("GLB 模型无效或超出安全限制。");
type ObjectValue = Record<string, unknown>;
function record(value: unknown): ObjectValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid();
  return value as ObjectValue;
}
function integer(value: unknown, max = MAX_MODEL_BYTES): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > max) throw invalid();
  return value;
}
function list(value: unknown): unknown[] {
  if (!Array.isArray(value) || value.length > 100000) throw invalid();
  return value;
}

// Deliberately accept the local converter's static, uncompressed triangle subset.
// No resource URLs, extensions, textures, animation or skinning reach the viewer.
export function validateModelGlb(bytes: Uint8Array): void {
  if (bytes.byteLength < 32 || bytes.byteLength > MAX_MODEL_BYTES) throw invalid();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2 || view.getUint32(8, true) !== bytes.length) throw invalid();
  const jsonLength = view.getUint32(12, true), binHeader = 20 + jsonLength;
  if (!jsonLength || jsonLength > 2 * 1024 ** 2 || jsonLength % 4 || binHeader + 8 > bytes.length || view.getUint32(16, true) !== 0x4e4f534a) throw invalid();
  const binLength = view.getUint32(binHeader, true), binStart = binHeader + 8;
  if (binLength % 4 || binStart + binLength !== bytes.length || view.getUint32(binHeader + 4, true) !== 0x004e4942) throw invalid();
  const doc = record(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(20, binHeader))));
  const visit = (value: unknown, depth = 0): void => {
    if (depth > 32 || (typeof value === "number" && !Number.isFinite(value))) throw invalid();
    if (value && typeof value === "object") for (const [key, child] of Object.entries(value)) {
      if (["uri", "extensions", "extensionsUsed", "extensionsRequired", "images", "textures", "animations", "skins", "sparse", "targets"].includes(key)) throw invalid();
      visit(child, depth + 1);
    }
  };
  visit(doc);
  if (record(doc.asset).version !== "2.0") throw invalid();
  const buffers = list(doc.buffers);
  if (buffers.length !== 1) throw invalid();
  const bufferLength = integer(record(buffers[0]).byteLength);
  if (!bufferLength || bufferLength > binLength || binLength - bufferLength > 3) throw invalid();
  const views = list(doc.bufferViews).map(value => {
    const item = record(value), offset = integer(item.byteOffset ?? 0), length = integer(item.byteLength);
    if (item.buffer !== 0 || !length || offset + length > bufferLength) throw invalid();
    return { offset, length, stride: item.byteStride === undefined ? undefined : integer(item.byteStride, 252) };
  });
  let inspectedComponents = 0;
  const accessors = list(doc.accessors).map(value => {
    const item = record(value), bufferView = views[integer(item.bufferView, views.length - 1)];
    const component = integer(item.componentType, 5126), count = integer(item.count, 6000000);
    const components = item.type === "SCALAR" ? 1 : item.type === "VEC3" ? 3 : item.type === "VEC4" ? 4 : 0;
    const width = component === 5126 || component === 5125 ? 4 : component === 5123 ? 2 : component === 5121 ? 1 : 0;
    const offset = integer(item.byteOffset ?? 0), stride = bufferView.stride ?? width * components;
    inspectedComponents += count * components;
    if (inspectedComponents > 25000000) throw invalid();
    if (!count || !width || !components || item.normalized === true || stride < width * components || stride % width || offset % width ||
      (bufferView.offset + offset) % width || offset + (count - 1) * stride + width * components > bufferView.length) throw invalid();
    const start = binStart + bufferView.offset + offset;
    const read = (index: number, axis = 0) => {
      const at = start + index * stride + axis * width;
      return component === 5126 ? view.getFloat32(at, true) : width === 4 ? view.getUint32(at, true) : width === 2 ? view.getUint16(at, true) : view.getUint8(at);
    };
    if (component === 5126) for (let i = 0; i < count; i++) for (let axis = 0; axis < components; axis++) if (!Number.isFinite(read(i, axis)) || Math.abs(read(i, axis)) > 1e12) throw invalid();
    return { component, count, components, read };
  });
  let triangles = 0;
  const meshTriangles = list(doc.meshes).map(value => {
    let meshCount = 0;
    for (const primitiveValue of list(record(value).primitives)) {
      const primitive = record(primitiveValue), attributes = record(primitive.attributes);
      if ((primitive.mode ?? 4) !== 4 || Object.keys(attributes).some(key => !["POSITION", "NORMAL", "COLOR_0"].includes(key))) throw invalid();
      const position = accessors[integer(attributes.POSITION, accessors.length - 1)];
      if (position.component !== 5126 || position.components !== 3) throw invalid();
      for (const [key, index] of Object.entries(attributes)) {
        const accessor = accessors[integer(index, accessors.length - 1)];
        if (accessor.count !== position.count || accessor.component !== 5126 || (key !== "COLOR_0" && accessor.components !== 3)) throw invalid();
      }
      let count = position.count;
      if (primitive.indices !== undefined) {
        const indices = accessors[integer(primitive.indices, accessors.length - 1)];
        if (indices.components !== 1 || indices.component === 5126) throw invalid();
        count = indices.count;
        if (count % 3 || triangles + meshCount + count / 3 > 2000000) throw invalid();
        for (let i = 0; i < count; i++) if (indices.read(i) >= position.count) throw invalid();
      }
      if (count % 3 || triangles + meshCount + count / 3 > 2000000) throw invalid();
      meshCount += count / 3;
      if (meshCount > 2000000) throw invalid();
    }
    triangles += meshCount;
    return meshCount;
  });
  if (!triangles || triangles > 2000000) throw invalid();
  const nodes = list(doc.nodes), parents = new Set<number>();
  let displayedTriangles = 0;
  for (const value of nodes) {
    const node = record(value);
    if (node.mesh !== undefined) displayedTriangles += meshTriangles[integer(node.mesh, meshTriangles.length - 1)];
    for (const key of ["matrix", "translation", "rotation", "scale"]) if (node[key] !== undefined) {
      const values = list(node[key]);
      if (values.length !== (key === "matrix" ? 16 : key === "rotation" ? 4 : 3) || values.some(value => typeof value !== "number" || !Number.isFinite(value))) throw invalid();
      const numbers = values as number[];
      if (numbers.some(n => Math.abs(n) > 1000000)) throw invalid();
      // Rigid transforms plus non-expanding unit scales bound world coordinates.
      if (key === "scale" && numbers.some(n => Math.abs(n) > 1)) throw invalid();
      if (key === "rotation" && Math.abs(numbers.reduce((sum,n)=>sum+n*n,0)-1)>0.00001) throw invalid();
      if (key === "matrix") {
        if (node.translation !== undefined || node.rotation !== undefined || node.scale !== undefined || numbers[3] !== 0 || numbers[7] !== 0 || numbers[11] !== 0 || numbers[15] !== 1) throw invalid();
        for (let col=0;col<3;col++) for(let other=col;other<3;other++) {
          const dot=[0,1,2].reduce((sum,row)=>sum+numbers[col*4+row]*numbers[other*4+row],0);
          if (col===other ? dot>1.00001 : Math.abs(dot)>0.00001) throw invalid();
        }
      }
    }
    for (const child of list(node.children ?? [])) {
      const index = integer(child, nodes.length - 1);
      if (parents.has(index)) throw invalid();
      parents.add(index);
    }
  }
  const seen = new Set<number>();
  const walk = (index: number, depth: number): void => {
    if (depth > 64 || seen.has(index)) throw invalid();
    seen.add(index);
    for (const child of list(record(nodes[index]).children ?? [])) walk(integer(child, nodes.length - 1), depth + 1);
  };
  for (let i = 0; i < nodes.length; i++) if (!parents.has(i)) walk(i, 0);
  if (seen.size !== nodes.length || !displayedTriangles || displayedTriangles > 2000000) throw invalid();
  const scenes = list(doc.scenes);
  integer(doc.scene ?? 0, scenes.length - 1);
  for (const scene of scenes) {
    const roots = new Set<number>();
    for (const value of list(record(scene).nodes)) {
      const index = integer(value, nodes.length - 1);
      if (parents.has(index) || roots.has(index)) throw invalid();
      roots.add(index);
    }
  }
  let visibleTriangles=0;
  const visible=(index:number):void=>{
    const node=record(nodes[index]);
    if(node.mesh!==undefined)visibleTriangles+=meshTriangles[integer(node.mesh,meshTriangles.length-1)];
    for(const child of list(node.children??[]))visible(integer(child,nodes.length-1));
  };
  for(const root of list(record(scenes[integer(doc.scene??0,scenes.length-1)]).nodes))visible(integer(root,nodes.length-1));
  if(!visibleTriangles)throw invalid();
}
