"""Private, PC-only STEP display conversion; invoked with a bounded process timeout."""
import json
import math
import re
from pathlib import Path
import struct
import sys

MAX_BYTES = 50 * 1024**2
MAX_SOURCE_BYTES = 2 * 1024**3
MAX_VERTICES = 1_000_000
MAX_TRIANGLES = 1_000_000
_memory_job = None


def constrain_process():
    """Limit this converter process only, never its Node parent."""
    global _memory_job
    if sys.platform == "win32":
        import ctypes
        from ctypes import wintypes

        class BasicLimits(ctypes.Structure):
            _fields_ = [("process_time", ctypes.c_int64), ("job_time", ctypes.c_int64),
                        ("flags", wintypes.DWORD), ("min_working_set", ctypes.c_size_t),
                        ("max_working_set", ctypes.c_size_t), ("active_processes", wintypes.DWORD),
                        ("affinity", ctypes.c_size_t), ("priority", wintypes.DWORD), ("scheduling", wintypes.DWORD)]

        class IoCounters(ctypes.Structure):
            _fields_ = [(name, ctypes.c_uint64) for name in ("read_ops", "write_ops", "other_ops", "read_bytes", "write_bytes", "other_bytes")]

        class ExtendedLimits(ctypes.Structure):
            _fields_ = [("basic", BasicLimits), ("io", IoCounters), ("process_memory", ctypes.c_size_t),
                        ("job_memory", ctypes.c_size_t), ("peak_process", ctypes.c_size_t), ("peak_job", ctypes.c_size_t)]

        kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel.CreateJobObjectW.argtypes = [ctypes.c_void_p, wintypes.LPCWSTR]
        kernel.CreateJobObjectW.restype = wintypes.HANDLE
        kernel.GetCurrentProcess.restype = wintypes.HANDLE
        kernel.SetInformationJobObject.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD]
        kernel.AssignProcessToJobObject.argtypes = [wintypes.HANDLE, wintypes.HANDLE]
        _memory_job = kernel.CreateJobObjectW(None, None)
        limits = ExtendedLimits()
        limits.basic.flags = 0x100 | 0x2000  # PROCESS_MEMORY | KILL_ON_JOB_CLOSE
        limits.process_memory = 2 * 1024**3
        if not _memory_job or not kernel.SetInformationJobObject(_memory_job, 9, ctypes.byref(limits), ctypes.sizeof(limits)) or not kernel.AssignProcessToJobObject(_memory_job, kernel.GetCurrentProcess()):
            raise RuntimeError("Cannot constrain converter")
    else:
        import resource
        resource.setrlimit(resource.RLIMIT_AS, (2 * 1024**3, 2 * 1024**3))
        resource.setrlimit(resource.RLIMIT_FSIZE, (MAX_BYTES, MAX_BYTES))


def check_glb(path):
    if not 28 <= path.stat().st_size <= MAX_BYTES:
        raise ValueError("GLB size")
    data = path.read_bytes()
    magic, version, length = struct.unpack_from("<III", data)
    if (magic, version, length) != (0x46546C67, 2, len(data)):
        raise ValueError("GLB header")
    offset, chunks = 12, []
    while offset < len(data):
        size, kind = struct.unpack_from("<II", data, offset)
        if size % 4 or offset + 8 + size > len(data):
            raise ValueError("GLB chunk")
        chunks.append((kind, data[offset + 8:offset + 8 + size]))
        offset += 8 + size
    if [kind for kind, _ in chunks] != [0x4E4F534A, 0x004E4942]:
        raise ValueError("GLB chunks")
    doc = json.loads(chunks[0][1])
    binary = chunks[1][1]

    def finite_and_embedded(value):
        if isinstance(value, dict):
            if "uri" in value or "extensions" in value:
                raise ValueError("External or extended resource")
            for item in value.values():
                finite_and_embedded(item)
        elif isinstance(value, list):
            for item in value:
                finite_and_embedded(item)
        elif isinstance(value, float) and not math.isfinite(value):
            raise ValueError("Nonfinite JSON")

    finite_and_embedded(doc)
    if len(doc.get("buffers", [])) != 1 or doc["buffers"][0]["byteLength"] > len(binary):
        raise ValueError("GLB buffer")
    vertices = triangles = 0
    for accessor in doc.get("accessors", []):
        count = accessor["count"]
        if not isinstance(count, int) or not 0 < count <= 3 * MAX_TRIANGLES or "sparse" in accessor:
            raise ValueError("Accessor count")
        view = doc["bufferViews"][accessor["bufferView"]]
        components = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}[accessor["type"]]
        component_size = {5121: 1, 5123: 2, 5125: 4, 5126: 4}[accessor["componentType"]]
        width = components * component_size
        stride = view.get("byteStride", width)
        start = view.get("byteOffset", 0) + accessor.get("byteOffset", 0)
        end = start + (count - 1) * stride + width
        if view.get("buffer", 0) != 0 or stride < width or start < 0 or end > len(binary) or end > view.get("byteOffset", 0) + view["byteLength"]:
            raise ValueError("Accessor bounds")
        if accessor["componentType"] == 5126:
            for index in range(count):
                if not all(math.isfinite(x) for x in struct.unpack_from("<" + "f" * components, binary, start + index * stride)):
                    raise ValueError("Nonfinite mesh")
    for mesh in doc.get("meshes", []):
        for primitive in mesh["primitives"]:
            if primitive.get("mode", 4) != 4:
                raise ValueError("Nontriangle mesh")
            position = doc["accessors"][primitive["attributes"]["POSITION"]]
            vertices += position["count"]
            index_count = doc["accessors"][primitive["indices"]]["count"] if "indices" in primitive else position["count"]
            if index_count % 3:
                raise ValueError("Triangle count")
            triangles += index_count // 3
    if not 0 < vertices <= MAX_VERTICES or not 0 < triangles <= MAX_TRIANGLES:
        raise ValueError("Mesh complexity")


def convert(source, output):
    import cadquery as cq
    from cadquery.occ_impl.exporters.assembly import exportGLTF

    if not source.is_file() or not 0 < source.stat().st_size <= MAX_SOURCE_BYTES or output.exists():
        raise ValueError("Input/output")
    # A standalone upload must never ask the CAD reader to resolve other files.
    if re.search(rb"\b(?:EXTERNAL_SOURCE|EXTERNALLY_DEFINED\w*|DOCUMENT_FILE)\s*\(", source.read_bytes(), re.IGNORECASE):
        raise ValueError("External STEP reference")
    try:
        assembly = cq.Assembly.importStep(str(source))
    except ValueError:
        # Native solid STEP files need not carry an assembly document.
        assembly = cq.Assembly(cq.importers.importStep(str(source)))
    shape = assembly.toCompound()
    if not shape.isValid() or not 0 < len(shape.Faces()) <= 100_000:
        raise ValueError("Invalid or complex shape")
    box = shape.BoundingBox()
    if not all(math.isfinite(x) for x in (box.xmin, box.ymin, box.zmin, box.xmax, box.ymax, box.zmax)) or box.DiagonalLength <= 0:
        raise ValueError("Invalid bounds")
    if not exportGLTF(assembly, str(output), binary=True, tolerance=max(0.1, box.DiagonalLength / 2000), angularTolerance=0.2):
        raise ValueError("Export failed")
    check_glb(output)


if __name__ == "__main__":
    try:
        if len(sys.argv) != 3:
            raise ValueError("Arguments")
        constrain_process()
        convert(Path(sys.argv[1]), Path(sys.argv[2]))
    except Exception:
        # Never expose STEP labels, local paths, or importer diagnostics remotely.
        print("STEP conversion failed", file=sys.stderr)
        sys.exit(1)
