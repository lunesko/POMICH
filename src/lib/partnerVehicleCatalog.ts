/** Sentinel value for custom make entry in the make dropdown. */
export const PARTNER_VEHICLE_MAKE_OTHER = "Інше"

/** Sentinel value for custom model entry in the model dropdown. */
export const PARTNER_VEHICLE_MODEL_OTHER = "Інша модель"

/** Common tow/roadside vehicle makes in Ukraine — alphabetical, «Інше» last. */
export const partnerVehicleMakes = [
  "Audi",
  "BMW",
  "Chevrolet",
  "Citroën",
  "DAF",
  "Fiat",
  "Ford",
  "GAZ",
  "Honda",
  "Hyundai",
  "Isuzu",
  "Iveco",
  "Kia",
  "Lada",
  "MAN",
  "Mazda",
  "Mercedes-Benz",
  "Mercedes Sprinter",
  "Mitsubishi",
  "Nissan",
  "Opel",
  "Peugeot",
  "Renault",
  "Renault Master",
  "Scania",
  "Skoda",
  "Suzuki",
  "Toyota",
  "UAZ",
  "Volkswagen",
  "Volvo",
  "ZAZ",
  PARTNER_VEHICLE_MAKE_OTHER,
] as const

/**
 * Popular vehicle models per make for Ukrainian roadside / tow partners.
 * Focus: vans, light trucks, and common passenger cars.
 */
export const partnerVehicleCatalog: Record<string, readonly string[]> = {
  Audi: [
    "A3",
    "A4",
    "A5",
    "A6",
    "A8",
    "Q3",
    "Q5",
    "Q7",
    "Q8",
    "e-tron",
  ],
  BMW: [
    "1 Series",
    "3 Series",
    "5 Series",
    "7 Series",
    "X1",
    "X3",
    "X5",
    "X6",
    "X7",
    "iX",
  ],
  Chevrolet: [
    "Aveo",
    "Captiva",
    "Cruze",
    "Lacetti",
    "Malibu",
    "Orlando",
    "Spark",
    "Tahoe",
    "Tracker",
    "Trax",
  ],
  Citroën: [
    "Berlingo",
    "C3",
    "C4",
    "C5 Aircross",
    "C5 X",
    "DS3",
    "DS4",
    "Jumper",
    "Jumpy",
    "SpaceTourer",
  ],
  DAF: [
    "CF",
    "LF",
    "LF 45",
    "LF 55",
    "XD",
    "XF",
    "XF 105",
    "XF 480",
    "XG",
    "XG+",
  ],
  Fiat: [
    "500",
    "Doblo",
    "Ducato",
    "Fiorino",
    "Fullback",
    "Panda",
    "Scudo",
    "Talento",
    "Tipo",
    "Tipo Van",
  ],
  Ford: [
    "Connect",
    "Fiesta",
    "Focus",
    "Kuga",
    "Mondeo",
    "Mustang",
    "Ranger",
    "Tourneo",
    "Transit",
    "Transit Custom",
  ],
  GAZ: [
    "3302",
    "Gazelle",
    "Gazelle Next",
    "Sobol",
    "Valdai",
    "Газель",
    "Соболь",
  ],
  Honda: [
    "Accord",
    "CR-V",
    "Civic",
    "HR-V",
    "Jazz",
    "Legend",
    "Pilot",
    "Stream",
    "ZR-V",
  ],
  Hyundai: [
    "Accent",
    "Elantra",
    "H-1",
    "i20",
    "i30",
    "Kona",
    "Santa Fe",
    "Sonata",
    "Staria",
    "Tucson",
  ],
  Iveco: [
    "Daily",
    "Daily 35C",
    "Daily 50C",
    "Daily 70C",
    "Eurocargo",
    "S-Way",
    "Stralis",
    "Trakker",
  ],
  Isuzu: [
    "D-Max",
    "Elf",
    "F-Series",
    "N-Series",
    "NQR",
  ],
  Kia: [
    "Ceed",
    "Niro",
    "Optima",
    "Picanto",
    "Rio",
    "Sorento",
    "Sportage",
    "Stonic",
    "XCeed",
  ],
  Lada: [
    "2107",
    "Granta",
    "Kalina",
    "Largus",
    "Niva",
    "Niva Travel",
    "Priora",
    "Vesta",
    "XRAY",
  ],
  MAN: [
    "L2000",
    "M2000",
    "TGE",
    "TGL",
    "TGM",
    "TGS",
    "TGX",
  ],
  Mazda: [
    "CX-3",
    "CX-30",
    "CX-5",
    "CX-60",
    "Mazda2",
    "Mazda3",
    "Mazda6",
    "MX-5",
  ],
  "Mercedes-Benz": [
    "Actros",
    "Atego",
    "Axor",
    "Citan",
    "E-Class",
    "G-Class",
    "Sprinter",
    "V-Class",
    "Vito",
    "Vito Tourer",
  ],
  "Mercedes Sprinter": [
    "Sprinter 311",
    "Sprinter 313",
    "Sprinter 316",
    "Sprinter 319",
    "Sprinter 515",
    "Sprinter 516",
    "Sprinter 519",
    "Sprinter L2H2",
    "Sprinter L3H2",
  ],
  Mitsubishi: [
    "ASX",
    "Eclipse Cross",
    "L200",
    "Lancer",
    "Outlander",
    "Pajero",
    "Pajero Sport",
    "Space Star",
  ],
  Nissan: [
    "Juke",
    "Leaf",
    "Micra",
    "Navara",
    "NV200",
    "NV400",
    "Patrol",
    "Qashqai",
    "X-Trail",
  ],
  Opel: [
    "Astra",
    "Combo",
    "Corsa",
    "Crossland",
    "Insignia",
    "Mokka",
    "Movano",
    "Vivaro",
    "Zafira",
    "Zafira Life",
  ],
  Peugeot: [
    "2008",
    "208",
    "3008",
    "308",
    "408",
    "5008",
    "508",
    "Boxer",
    "Expert",
    "Partner",
  ],
  Renault: [
    "Arkana",
    "Captur",
    "Clio",
    "Duster",
    "Kangoo",
    "Koleos",
    "Logan",
    "Master",
    "Megane",
    "Sandero",
    "Trafic",
  ],
  "Renault Master": [
    "Master II",
    "Master III",
    "Master L2H2",
    "Master L3H2",
    "Master dCi 125",
    "Master dCi 150",
    "Master dCi 165",
  ],
  Scania: [
    "G-series",
    "L-series",
    "P-series",
    "R-series",
    "R 450",
    "S-series",
  ],
  Skoda: [
    "Fabia",
    "Kamiq",
    "Karoq",
    "Kodiaq",
    "Octavia",
    "Rapid",
    "Scala",
    "Superb",
    "Yeti",
  ],
  Suzuki: [
    "Grand Vitara",
    "Ignis",
    "Jimny",
    "SX4",
    "Swift",
    "Swace",
    "Vitara",
    "XL7",
  ],
  Toyota: [
    "Camry",
    "Corolla",
    "Highlander",
    "Hilux",
    "Land Cruiser",
    "Prius",
    "Proace",
    "RAV4",
    "Yaris",
    "Yaris Cross",
  ],
  UAZ: [
    "Bukhanka",
    "Hunter",
    "Patriot",
    "Pickup",
    "Profi",
    "СGR Expeditor",
  ],
  Volkswagen: [
    "Amarok",
    "Caddy",
    "Caravelle",
    "Crafter",
    "Golf",
    "Multivan",
    "Passat",
    "Tiguan",
    "Touareg",
    "Transporter",
  ],
  Volvo: [
    "FE",
    "FH",
    "FL",
    "FM",
    "V60",
    "V90",
    "XC40",
    "XC60",
    "XC90",
  ],
  ZAZ: [
    "Chance",
    "Forza",
    "Lanos",
    "Sens",
    "Vida",
    "Tavria",
  ],
}

export function getModelsForMake(make: string): readonly string[] {
  const normalizedMake = make.trim()
  if (!normalizedMake || normalizedMake === PARTNER_VEHICLE_MAKE_OTHER) return []
  return partnerVehicleCatalog[normalizedMake] ?? []
}

/** Alias used by PartnerVehicleFields. */
export function getPartnerVehicleModels(make: string): readonly string[] {
  return getModelsForMake(make)
}

export function isKnownPartnerVehicleModel(make: string, model: string): boolean {
  const normalizedModel = model.trim()
  if (!normalizedModel) return false
  return getModelsForMake(make).includes(normalizedModel)
}

/** Alias used by PartnerVehicleFields. */
export function isCatalogPartnerVehicleModel(make: string, model: string): boolean {
  return isKnownPartnerVehicleModel(make, model)
}

export function resolvePartnerVehicleModelSelectValue(make: string, model: string): string {
  const normalizedModel = model.trim()
  if (!normalizedModel) return ""
  if (isKnownPartnerVehicleModel(make, normalizedModel)) return normalizedModel
  return PARTNER_VEHICLE_MODEL_OTHER
}

/** Every catalogued make should appear in partnerVehicleMakes (except «Інше»). */
export function partnerVehicleCatalogMakes(): string[] {
  return Object.keys(partnerVehicleCatalog).sort((left, right) => left.localeCompare(right, "uk"))
}

export function partnerVehicleCatalogStats(): { makes: number; models: number } {
  const makes = Object.keys(partnerVehicleCatalog).length
  const models = Object.values(partnerVehicleCatalog).reduce((total, list) => total + list.length, 0)
  return { makes, models }
}

/** Validates catalog ↔ constants alignment in tests. */
export function partnerVehicleCatalogCoversKnownMakes(): boolean {
  const catalogMakes = new Set(Object.keys(partnerVehicleCatalog))
  return partnerVehicleMakes
    .filter((make) => make !== PARTNER_VEHICLE_MAKE_OTHER)
    .every((make) => catalogMakes.has(make))
}
