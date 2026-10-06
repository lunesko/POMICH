export default function BetaNotice({ compact = false }: { compact?: boolean }) {
  if (compact) {
    return (
      <details className="pomich-beta-badge">
        <summary aria-label="Бета-Тестування: інформація про тестовий режим">Бета</summary>
        <div className="pomich-beta-badge__message">
          <strong>Бета-Тестування</strong>
          <p>Сервіс працює в тестовому режимі. Можливі помилки та збої в роботі. Дякуємо за розуміння!</p>
        </div>
      </details>
    )
  }
  return (
    <aside className="pomich-beta-notice" aria-label="Бета-Тестування">
      <strong>Бета-Тестування</strong>
      <span>Сервіс працює в тестовому режимі. Можливі помилки та збої в роботі. Дякуємо за розуміння!</span>
    </aside>
  )
}
