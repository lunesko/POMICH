import { useEffect, useState } from "react"
import {
  PARTNER_VEHICLE_MAKE_OTHER,
  PARTNER_VEHICLE_MODEL_OTHER,
  getPartnerVehicleModels,
  isCatalogPartnerVehicleModel,
  partnerVehicleMakes,
  resolvePartnerVehicleModelSelectValue,
} from "../../lib/partnerVehicleCatalog"
import {
  composePartnerVehicle,
  type PartnerRegistrationForm,
} from "../../lib/constants"

function syncVehicle(
  make: string,
  model: string,
  customMake: string,
): Pick<PartnerRegistrationForm, "vehicle"> {
  return { vehicle: composePartnerVehicle(make, model, customMake) }
}

function modelSelectValue(make: string, model: string): string {
  return resolvePartnerVehicleModelSelectValue(make, model)
}

export function PartnerVehicleFields({
  form,
  onChange,
  labelClassName = "pomich-form-label",
  inputClassName = "pomich-form-input",
}: {
  form: Pick<PartnerRegistrationForm, "vehicleMake" | "vehicleMakeOther" | "vehicleModel">
  onChange: (patch: Partial<PartnerRegistrationForm>) => void
  labelClassName?: string
  inputClassName?: string
}) {
  const isOtherMake = form.vehicleMake === PARTNER_VEHICLE_MAKE_OTHER
  const models = form.vehicleMake && !isOtherMake ? getPartnerVehicleModels(form.vehicleMake) : []
  const [customModelOpen, setCustomModelOpen] = useState(() => (
    Boolean(form.vehicleMake)
    && form.vehicleMake !== PARTNER_VEHICLE_MAKE_OTHER
    && Boolean(form.vehicleModel.trim())
    && !isCatalogPartnerVehicleModel(form.vehicleMake, form.vehicleModel)
  ))

  useEffect(() => {
    if (!form.vehicleMake || isOtherMake) {
      setCustomModelOpen(false)
      return
    }
    if (form.vehicleModel.trim() && !isCatalogPartnerVehicleModel(form.vehicleMake, form.vehicleModel)) {
      setCustomModelOpen(true)
    }
  }, [form.vehicleMake, form.vehicleModel, isOtherMake])

  const modelSelection = customModelOpen
    ? PARTNER_VEHICLE_MODEL_OTHER
    : modelSelectValue(form.vehicleMake, form.vehicleModel)
  const showCustomModelInput = Boolean(form.vehicleMake && !isOtherMake && customModelOpen)

  return (
    <>
      <label style={{ display: "grid", gap: 6 }}>
        <span className={labelClassName}>Марка авто</span>
        <select
          value={form.vehicleMake}
            onChange={(event) => {
            const vehicleMake = event.target.value
            setCustomModelOpen(false)
            onChange({
              vehicleMake,
              vehicleMakeOther: vehicleMake === PARTNER_VEHICLE_MAKE_OTHER ? form.vehicleMakeOther : "",
              vehicleModel: "",
              ...syncVehicle(
                vehicleMake,
                "",
                vehicleMake === PARTNER_VEHICLE_MAKE_OTHER ? form.vehicleMakeOther : "",
              ),
            })
          }}
          className={inputClassName}
        >
          <option value="">Оберіть марку</option>
          {partnerVehicleMakes.map((make) => (
            <option key={make} value={make}>{make}</option>
          ))}
        </select>
      </label>

      {isOtherMake ? (
        <>
          <label style={{ display: "grid", gap: 6 }}>
            <span className={labelClassName}>Вкажіть марку</span>
            <input
              value={form.vehicleMakeOther}
              onChange={(event) => onChange({
                vehicleMakeOther: event.target.value,
                ...syncVehicle(form.vehicleMake, form.vehicleModel, event.target.value),
              })}
              placeholder="Наприклад, ZAZ або ГАЗ"
              required
              className={inputClassName}
            />
          </label>
          <label style={{ display: "grid", gap: 6 }}>
            <span className={labelClassName}>Модель</span>
            <input
              value={form.vehicleModel}
              onChange={(event) => onChange({
                vehicleModel: event.target.value,
                ...syncVehicle(form.vehicleMake, event.target.value, form.vehicleMakeOther),
              })}
              placeholder="Вкажіть модель"
              className={inputClassName}
            />
          </label>
        </>
      ) : form.vehicleMake ? (
        <>
          <label style={{ display: "grid", gap: 6 }}>
            <span className={labelClassName}>Модель</span>
            <select
              value={modelSelection}
              disabled={models.length === 0}
              onChange={(event) => {
                const nextSelection = event.target.value
                const useCustomModel = nextSelection === PARTNER_VEHICLE_MODEL_OTHER
                setCustomModelOpen(useCustomModel)
                const vehicleModel = useCustomModel ? "" : nextSelection
                onChange({
                  vehicleModel,
                  ...syncVehicle(form.vehicleMake, vehicleModel, form.vehicleMakeOther),
                })
              }}
              className={inputClassName}
            >
              <option value="">Оберіть модель</option>
              {models.map((model) => (
                <option key={model} value={model}>{model}</option>
              ))}
              <option value={PARTNER_VEHICLE_MODEL_OTHER}>{PARTNER_VEHICLE_MODEL_OTHER}</option>
            </select>
          </label>
          {showCustomModelInput ? (
            <label style={{ display: "grid", gap: 6 }}>
              <span className={labelClassName}>Вкажіть модель</span>
              <input
                value={form.vehicleModel}
                onChange={(event) => onChange({
                  vehicleModel: event.target.value,
                  ...syncVehicle(form.vehicleMake, event.target.value, form.vehicleMakeOther),
                })}
                placeholder="Наприклад, Transporter T6"
                className={inputClassName}
              />
            </label>
          ) : null}
        </>
      ) : null}
    </>
  )
}
