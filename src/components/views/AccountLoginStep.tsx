import { FormContainer } from "../layout/FormContainer"
import { Header } from "../layout/Header"
import { ScreenLayout } from "../layout/ScreenLayout"
import { PrimaryButton } from "../ui/PrimaryButton"

interface AccountLoginStepProps {
  title: string
  subtitle: string
  login: string
  password: string
  saving: boolean
  error?: string
  onLoginChange: (value: string) => void
  onPasswordChange: (value: string) => void
  onSubmit: () => void
  onRegister?: () => void
}

export function AccountLoginStep({
  title,
  subtitle,
  login,
  password,
  saving,
  error,
  onLoginChange,
  onPasswordChange,
  onSubmit,
  onRegister,
}: AccountLoginStepProps) {
  return (
    <ScreenLayout footer={<PrimaryButton label={saving ? "Входимо…" : "Увійти"} onClick={onSubmit} disabled={!login.trim() || !password.trim() || saving} />}>
      <Header title={title} subtitle={subtitle} />
      <FormContainer>
        <div className="pomich-form-card">
          <label style={{ display: "grid", gap: 6 }}>
            <span className="pomich-form-label">Логін</span>
            <input value={login} onChange={(event) => onLoginChange(event.target.value)} autoComplete="username" className="pomich-form-input" />
          </label>
          <label style={{ display: "grid", gap: 6 }}>
            <span className="pomich-form-label">Пароль</span>
            <input value={password} onChange={(event) => onPasswordChange(event.target.value)} type="password" autoComplete="current-password" className="pomich-form-input" />
          </label>
        </div>
        {onRegister ? (
          <button type="button" onClick={onRegister} className="pomich-ghost-btn" style={{ width: "100%", color: "var(--pomich-accent)" }}>
            Новий партнер? Зареєструватись
          </button>
        ) : null}
        {error ? <div className="pomich-form-error">{error}</div> : null}
      </FormContainer>
    </ScreenLayout>
  )
}
