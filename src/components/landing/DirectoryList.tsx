import { useState } from "react"
import type { ProviderAvailability } from "../../api/client"

export default function DirectoryList({ providers }: { providers: ProviderAvailability[] }) {
  const [query, setQuery] = useState("")
  const [limit, setLimit] = useState(30)
  const matched = providers.filter((item) => `${item.name} ${item.city || ""} ${item.address || ""}`.toLocaleLowerCase("uk").includes(query.toLocaleLowerCase("uk")))
  return <details className="pomich-directory-list">
    <summary>Текстовий список сервісів ({providers.length})</summary>
    <p>Записи довідника не означають, що виконавець зараз на лінії.</p>
    <label>Назва, місто або адреса <input type="search" value={query} onChange={(event) => { setQuery(event.target.value); setLimit(30) }} /></label>
    <ul>{matched.slice(0, limit).map((item) => <li key={item.id}><strong>{item.name}</strong> — {item.address || item.city || "Адресу не вказано"}</li>)}</ul>
    {!matched.length ? <p role="status">Сервісів не знайдено.</p> : null}
    {limit < matched.length ? <button type="button" onClick={() => setLimit((value) => value + 30)}>Показати ще 30</button> : null}
  </details>
}
