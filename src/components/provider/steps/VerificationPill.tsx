import { type VerificationStatus } from "../../../api/client"
import { verificationLabel, verificationTone } from "../../../lib/constants"

export default function VerificationPill({ status }: { status?: VerificationStatus }) {
  const tone = verificationTone(status)
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, borderRadius: 999, padding: "5px 9px", background: tone.background, color: tone.color, border: `1px solid ${tone.border}`, fontSize: 11, fontWeight: 900 }}>
      <span style={{ width: 6, height: 6, borderRadius: 999, background: "currentColor" }} />
      {verificationLabel(status)}
    </span>
  )
}
