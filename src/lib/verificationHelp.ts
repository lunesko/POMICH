import type { CustomerProfile } from "../api/client"

import { isCustomerProfileComplete, isCustomerVerified } from "./customerProfile"

export function verificationHelpText(profile: CustomerProfile): string {
  if (isCustomerVerified(profile)) {
    return "Профіль підтверджено кодом. Можете викликати допомогу — партнер зв'яжеться з вами за збереженими контактами."
  }
  if (isCustomerProfileComplete(profile)) {
    return "Ім'я та телефон збережено. Надішліть код у Telegram або на email і підтвердіть його — код діє 10 хвилин."
  }
  return "Заповніть ім'я та телефон, потім підтвердіть профіль кодом з Telegram або email."
}

export function verificationSteps(profile: CustomerProfile): string[] {
  if (isCustomerVerified(profile)) {
    return ["Ім'я та телефон збережено", "Профіль підтверджено", "Можна оформлювати заявку"]
  }
  if (isCustomerProfileComplete(profile)) {
    return ["Ім'я та телефон збережено", "Надішліть код у Telegram або на email", "Введіть код і натисніть «Підтвердити»"]
  }
  return ["Вкажіть ім'я та телефон", "Збережіть профіль", "Підтвердіть кодом з Telegram або email"]
}
