import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"

import { CitySelect } from "./CitySelect"

describe("CitySelect", () => {
  it("renders Оберіть місто dropdown with Kyiv first", async () => {
    const user = userEvent.setup()
    let value = ""
    const { rerender } = render(
      <CitySelect
        value={value}
        onChange={(city) => {
          value = city
          rerender(<CitySelect value={value} onChange={(next) => { value = next }} />)
        }}
      />,
    )

    const select = screen.getByLabelText(/Оберіть місто/i)
    expect(select).toBeInTheDocument()
    const options = screen.getAllByRole("option")
    expect(options[1]?.textContent).toMatch(/Київ/)
    await user.selectOptions(select, "Львів")
    expect(value).toBe("Львів")
  })
})
