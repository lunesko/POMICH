export default function BrandLogo({ compact = false }: { compact?: boolean }) {
  return (
    <img
      src="/pomich-logo.png"
      alt="POMICH"
      width={2149}
      height={732}
      draggable={false}
      style={{
        display: "block",
        width: compact ? 128 : 160,
        maxWidth: "100%",
        height: "auto",
        flexShrink: 0,
        objectFit: "contain",
        background: "#ffffff",
        borderRadius: 10,
        padding: 4,
      }}
    />
  )
}
