export type Project = {
  slug: string; title: string; subtitle: string; category: string;
  tags: string[]; summary: string; number: string;
};

// These are explicitly permitted draft subjects, not confirmed achievements.
export const projects: Project[] = [
  { slug: "apes", title: "APES", subtitle: "Autonomous Propulsion Engineering System", category: "Computational design", tags: ["Propulsion", "Simulation"], number: "01", summary: "A draft project space for computational propulsion design, its methods, and validation evidence." },
  { slug: "af-mpdt", title: "AF-MPDT", subtitle: "Applied-field magnetoplasmadynamic propulsion", category: "Electric propulsion", tags: ["Propulsion", "Experimental hardware"], number: "02", summary: "A draft project space for electric propulsion hardware, analysis, and experimental records." },
  { slug: "solid-rocket", title: "Solid rocket", subtitle: "Propulsion & experimental hardware", category: "Rocket propulsion", tags: ["Propulsion", "Experimental hardware"], number: "03", summary: "A draft project space for rocket engineering, with design intent and verified results kept distinct." }
];
