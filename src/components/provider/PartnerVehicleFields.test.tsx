import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { emptyPartnerRegistrationForm } from "../../lib/constants"
import { PARTNER_VEHICLE_MODEL_OTHER } from "../../lib/partnerVehicleCatalog"
import { PartnerVehicleFields } from "./PartnerVehicleFields"

function renderFields(overrides: Partial<ReturnType<typeof emptyPartnerRegistrationForm>> = {}) {
  const form = { ...emptyPartnerRegistrationForm(), ...overrides }
  const onChange = vi.fn()
  render(<PartnerVehicleFields form={form} onChange={onChange} />)
  return { form, onChange }
}

describe("PartnerVehicleFields", () => {
  it("shows model select only after make is chosen", () => {
    renderFields()
    expect(screen.getByRole("combobox", { name: /Марка авто/i })).toBeInTheDocument()
    expect(screen.queryByRole("combobox", { name: /Модель/i })).not.toBeInTheDocument()
  })

  it("lists catalog models for selected make", async () => {
    const user = userEvent.setup()
    renderFields({ vehicleMake: "Volkswagen" })

    const modelSelect = screen.getByRole("combobox", { name: /Модель/i })
    expect(modelSelect).toBeInTheDocument()
    expect(screen.getByRole("option", { name: "Transporter" })).toBeInTheDocument()
    expect(screen.getByRole("option", { name: PARTNER_VEHICLE_MODEL_OTHER })).toBeInTheDocument()

    await user.selectOptions(modelSelect, "Transporter")
  })

  it("resets model when make changes", async () => {
    const user = userEvent.setup()
    const { onChange } = renderFields({ vehicleMake: "Ford", vehicleModel: "Transit" })

    await user.selectOptions(screen.getByRole("combobox", { name: /Марка авто/i }), "Toyota")

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      vehicleMake: "Toyota",
      vehicleModel: "",
      vehicle: "Toyota",
    }))
  })

  it("shows custom model input for «Інша модель»", async () => {
    const user = userEvent.setup()
    renderFields({ vehicleMake: "Ford" })

    await user.selectOptions(screen.getByRole("combobox", { name: /Модель/i }), PARTNER_VEHICLE_MODEL_OTHER)

    expect(screen.getByPlaceholderText("Наприклад, Transporter T6")).toBeInTheDocument()
  })

  it("uses text inputs for «Інше» make flow", () => {
    renderFields({ vehicleMake: "Інше", vehicleMakeOther: "ZAZ" })

    expect(screen.getByRole("textbox", { name: /Вкажіть марку/i })).toBeInTheDocument()
    expect(screen.getByPlaceholderText("Вкажіть модель")).toBeInTheDocument()
    expect(screen.queryByRole("combobox", { name: /Модель/i })).not.toBeInTheDocument()
  })

  it("applies pomich-form-input class to selects", () => {
    renderFields({ vehicleMake: "Skoda" })

    expect(screen.getByRole("combobox", { name: /Марка авто/i })).toHaveClass("pomich-form-input")
    expect(screen.getByRole("combobox", { name: /Модель/i })).toHaveClass("pomich-form-input")
  })
})
