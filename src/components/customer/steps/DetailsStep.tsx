import { RideScreen } from "../../layout/RideScreen"
import { serviceRequiresDestination } from "../../../lib/pomichDomain"
import { type Point } from "../../../lib/constants"
import { serviceDetailQuestions, serviceDetailsComplete, serviceDetailsEmergency, serviceDetailsHeadings, type ServiceDetails } from "../../../lib/serviceDetails"
import StepBadge from "./StepBadge"
import PrimaryButton from "./PrimaryButton"
import StepBack from "./StepBack"
import SheetHeading from "./SheetHeading"
import { BRAND, DARK, SUBTLE, MUTED } from "./flowTheme"

export default function DetailsStep({ pickup, destination, details, isTelegram, onChange, onNext, onBack }: { pickup: Point; destination: Point; details: ServiceDetails; isTelegram?: boolean; onChange: (details: ServiceDetails) => void; onNext: () => void; onBack: () => void }) {
  const questions = serviceDetailQuestions(details.service, details.answers)
  const heading = serviceDetailsHeadings[details.service]
  const emergency = serviceDetailsEmergency(details)
  const totalSteps = serviceRequiresDestination(details.service) ? 5 : 4
  const currentStep = serviceRequiresDestination(details.service) ? 4 : 3

  return (
    <RideScreen pickup={pickup} destination={destination} mapSubtitle="Підбір виконавця">
      <StepBadge step={currentStep} total={totalSteps} label="Деталі допомоги" />
      <StepBack onBack={onBack} hide={isTelegram} />
      <SheetHeading title={heading.title} subtitle={heading.subtitle} />

      <div style={{ marginTop: 16, display: "grid", gap: 18 }}>
        {questions.map((question) => (
          <fieldset key={question.id} style={{ margin: 0, padding: 0, border: 0 }}>
            <legend style={{ color: DARK, fontSize: 15, fontWeight: 950, marginBottom: 4 }}>{question.label}</legend>
            {question.hint ? <div style={{ color: MUTED, fontSize: 12, fontWeight: 750, marginBottom: 8 }}>{question.hint}</div> : null}
            <div
              role="radiogroup"
              aria-label={question.label}
              style={{ display: "grid", gap: 8 }}
              onKeyDown={(event) => {
                const keys = ["ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft", "Home", "End"]
                if (!keys.includes(event.key)) return
                const options = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]'))
                const current = options.indexOf(document.activeElement as HTMLButtonElement)
                if (current < 0) return
                event.preventDefault()
                const next = event.key === "Home" ? 0 : event.key === "End" ? options.length - 1
                  : (current + (event.key === "ArrowDown" || event.key === "ArrowRight" ? 1 : -1) + options.length) % options.length
                const answer = question.options[next]
                onChange({ ...details, answers: { ...details.answers, [question.id]: answer.value } })
                options[next].focus()
              }}
            >
              {question.options.map((option, index) => {
                const selected = details.answers[question.id] === option.value
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    tabIndex={selected || (!details.answers[question.id] && index === 0) ? 0 : -1}
                    onClick={() => onChange({ ...details, answers: { ...details.answers, [question.id]: option.value } })}
                    className={`pomich-choice-option${selected ? " is-selected" : ""}`}
                  >
                    <span style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
                      <span>
                        <span style={{ display: "block" }}>{option.label}</span>
                        {option.hint ? <span style={{ display: "block", color: MUTED, fontSize: 12, marginTop: 3 }}>{option.hint}</span> : null}
                      </span>
                      <span aria-hidden="true" style={{ color: selected ? BRAND : SUBTLE }}>{selected ? "✓" : "○"}</span>
                    </span>
                  </button>
                )
              })}
            </div>
          </fieldset>
        ))}
      </div>
      {emergency ? (
        <div role="alert" style={{ marginTop: 14, background: "var(--pomich-error-bg)", color: "var(--pomich-error-text)", borderRadius: 14, padding: 12, fontWeight: 850, lineHeight: 1.45 }}>
          {emergency} <a href="tel:112" style={{ color: "inherit", textDecoration: "underline" }}>Зателефонувати 112</a>
        </div>
      ) : null}
      {isTelegram ? null : (
        <div style={{ marginTop: 16 }}>
          <PrimaryButton label="Далі" onClick={onNext} disabled={!serviceDetailsComplete(details)} />
          {!serviceDetailsComplete(details) ? <div className="pomich-disabled-reason">Дайте відповідь на всі обов’язкові питання.</div> : null}
        </div>
      )}
    </RideScreen>
  )
}
