import type { CustomerProfile, VerificationStatus } from "../../api/client"
import { customerProfileStatusLabel, customerProfileStatusTone, isCustomerVerified } from "../../lib/customerProfile"
import { verificationLabel, verificationTone } from "../../lib/constants"

interface VerificationPillProps {
  status?: VerificationStatus
  /** When set, shows profile completion badge instead of admin verification status. */
  profile?: CustomerProfile
}

export function VerificationPill({ status, profile }: VerificationPillProps) {
  if (profile && isCustomerVerified(profile)) return null

  const tone = profile ? customerProfileStatusTone(profile) : verificationTone(status)
  const label = profile ? customerProfileStatusLabel(profile) : verificationLabel(status)

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, borderRadius: 999, padding: "7px 10px", background: tone.background, border: `1px solid ${tone.border}`, color: tone.color, fontSize: 12, fontWeight: 950, whiteSpace: "nowrap" }}>
      <span style={{ width: 7, height: 7, borderRadius: 999, background: tone.color }} />
      {label}
    </span>
  )
}
