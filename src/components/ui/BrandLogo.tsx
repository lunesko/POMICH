export default function BrandLogo({ compact = false }: { compact?: boolean }) {
  return (
    <img
      src="/pomich-logo-transparent.png"
      alt="POMICH"
      width={2172}
      height={724}
      draggable={false}
      style={{
        display: "block",
        width: compact ? 128 : 160,
        maxWidth: "100%",
        height: "auto",
        flexShrink: 0,
        objectFit: "contain",
      }}
    />
  )
}
