import { useState } from "react"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { UkrainePlateInput } from "./UkrainePlateInput"

function ControlledPlateInput({ initial = "" }: { initial?: string }) {
  const [value, setValue] = useState(initial)
  return <UkrainePlateInput value={value} onChange={setValue} />
}

describe("UkrainePlateInput", () => {
  it("renders Auto.ria-style plate widget with UA strip", () => {
    render(<UkrainePlateInput value="" onChange={vi.fn()} />)

    expect(document.querySelector(".pomich-plate")).toBeInTheDocument()
    expect(document.querySelector(".pomich-plate__strip")).toBeInTheDocument()
    expect(screen.getByText("UA")).toBeInTheDocument()
    expect(screen.getByRole("textbox", { name: /Номер авто/i })).toHaveClass("pomich-plate__field")
  })

  it("shows formatted plate value and masks input", async () => {
    const user = userEvent.setup()
    render(<ControlledPlateInput initial="BX 5874 HX" />)

    const input = screen.getByRole("textbox", { name: /Номер авто/i })
    expect(input).toHaveValue("BX 5874 HX")

    await user.clear(input)
    await user.type(input, "bx5874hx")
    expect(input).toHaveValue("BX 5874 HX")
  })

  it("rejects nonsense Cyrillic via mask", async () => {
    const user = userEvent.setup()
    render(<ControlledPlateInput />)

    const input = screen.getByRole("textbox", { name: /Номер авто/i })
    await user.type(input, "афыввфы")
    expect(input).toHaveValue("AB")
  })

  it("shows validation error", () => {
    render(<UkrainePlateInput value="" onChange={vi.fn()} error="Введіть номер авто" />)

    expect(document.querySelector(".pomich-plate-input.is-error")).toBeInTheDocument()
    expect(screen.getByText("Введіть номер авто")).toBeInTheDocument()
  })
})
