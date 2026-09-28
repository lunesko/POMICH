import { describe, expect, it } from "vitest"

import {
  createServiceDetails,
  serviceDetailQuestions,
  serviceDetailRows,
  serviceDetailsComplete,
  serviceDetailsEmergency,
  summarizeServiceDetails,
  type ServiceDetails,
} from "./serviceDetails"
import type { ServiceKey } from "./pomichDomain"

const completeAnswers: Record<ServiceKey, Record<string, string>> = {
  tow: { incident: "breakdown", mobility: "rolls" },
  battery: { symptom: "silent", help: "jump" },
  wheel: { damage: "one", spare: "yes" },
  fuel: { fuelType: "diesel", amount: "5" },
  lockout: { keySituation: "inside", occupants: "none" },
  mechanic: { issue: "overheating", mobility: "stopped" },
}

describe("serviceDetails", () => {
  it.each(Object.keys(completeAnswers) as ServiceKey[])("requires relevant answers for %s", (service) => {
    expect(serviceDetailsComplete(createServiceDetails(service))).toBe(false)
    const details: ServiceDetails = { version: 1, service, answers: completeAnswers[service] }
    expect(serviceDetailsComplete(details)).toBe(true)
    expect(serviceDetailRows(details)).toHaveLength(2)
    expect(summarizeServiceDetails(details)).not.toBe("")
  })

  it("adds the injury question only after an accident", () => {
    expect(serviceDetailQuestions("tow", { incident: "breakdown" }).map((item) => item.id)).not.toContain("injuries")
    expect(serviceDetailQuestions("tow", { incident: "accident" }).map((item) => item.id)).toContain("injuries")
    expect(serviceDetailsComplete({ version: 1, service: "tow", answers: { incident: "accident", mobility: "locked" } })).toBe(false)
  })

  it("raises safety guidance for injuries and a locked-in child or animal", () => {
    expect(serviceDetailsEmergency({ version: 1, service: "tow", answers: { incident: "accident", injuries: "yes" } })).toContain("112")
    expect(serviceDetailsEmergency({ version: 1, service: "lockout", answers: { occupants: "childPet" } })).toContain("112")
  })
})
