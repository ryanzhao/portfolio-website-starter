export const portfolioSections = [
  { slug: "advanced-rockets-engines", number: "I", title: "Advanced Rockets & Engines", quote: "I don’t ignite rockets — I ignite dreams.", layout: "cover", image: "Rocket / propulsion experiment", projects: ["Level 1 Rocket Using Accessible Materials", "Advanced Propelled Rocket With Modular Secondaries", "Applied-field Magnetoplasmadynamic Thruster (AF-MPDT)"] },
  { slug: "chemistry-propellant", number: "II", title: "Chemistry & Propellant", quote: "My creation begins with reaction.", layout: "cover", image: "Chemistry / propellant experiment", projects: ["DNOAF based Propellant", "Electrically Controlled Solid Propellants", "YBCO Superconductor"] },
  { slug: "electronics", number: "III", title: "Electronics & Control Systems", quote: "Connecting thought to circuits.", layout: "pair", image: "Control panel", projects: ["Rocket Flight Computer", "AF-MPDT Electrical Control System", "Drone Flight Computer"] },
  { slug: "education-outreach", number: "IV", title: "Education & Outreach", quote: "I don’t own the idea that might change the world — I share it.", layout: "split", image: "Classroom / outreach photograph", projects: [] },
  { slug: "teamworks", number: "V", title: "Team works & Leadership", quote: "This domain carries the initials of the first team I created—the beginning of everything that followed.", layout: "team", image: "Team photograph", projects: [] }
] as const;

// Source: owner's Canva diagram; reference history, not new engineering validation.
export const journeyLanes = [
  { title: "Advanced Rockets & Engines", slug: "advanced-rockets-engines", steps: [
    { year: "2023", title: "Level 1 Rocket Using Accessible Materials", details: ["Motor Load Cells", "Static Test Stands", "Solid Rocket Motor", "High-Temp Insulation"] },
    { year: "2024", title: "Advanced Propelled Rocket With Modular Secondaries", details: ["Assembling Lathe", "Components Machining"] },
    { year: "2025", title: "Applied-field Magnetoplasmadynamic Thruster (AF-MPDT)", details: ["High Vacuum Chamber"] }
  ] },
  { title: "Chemistry & Propellant", slug: "chemistry-propellant", steps: [
    { year: "2023", title: "Sugar propellants / Black Powder", details: ["Epoxy-AP Propellants"] },
    { year: "2024", title: "APCP Propellants / DNOAF based Propellant", details: ["Organic Synthesis", "DIY Fume Hood"] },
    { year: "2025", title: "Electrically Controlled Solid Propellants", details: ["Oxygen Sintering Furnace", "HAN-based monopropellants", "Noble Gas Propellant", "YBCO Superconductor"] }
  ] },
  { title: "Electronics & Control Systems", slug: "electronics", steps: [
    { year: "2023", title: "Drone Flight Computer", details: ["DIY Remote Control", "PCB Design"] },
    { year: "2024", title: "Rocket Flight Computer", details: ["Rocket Ignition", "Data Recording"] },
    { year: "2025", title: "AF-MPDT Electrical Control System", details: ["Control Panel", "High Voltage Ignition"] }
  ] }
];
