import { type VerificationStatus } from "../../../api/client"
import { verificationLabel, verificationTone } from "../../../lib/constants"

export default function VerificationPill({ status }: { status?: VerificationStatus }) {
  const tone = verificationTone(status)
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, borderRadius: 999, padding: "7px 10px", background: tone.background, border: `1px solid ${tone.border}`, color: tone.color, fontSize: 12, fontWeight: 950, whiteSpace: "nowrap" }}>
      <span style={{ width: 7, height: 7, borderRadius: 999, background: tone.color }} />
      {verificationLabel(status)}
    </span>
  )
}
