import type { ServiceDetails } from '../lib/serviceDetails'

export interface OrderResponse {
  id?: string
  createdAt?: string
  updatedAt?: string
  status?: string
  service?: string
  source?: string
  customerLocation?: string
  destination?: string
  distanceKm?: number
  chatId?: string
  telegramUsername?: string
  vehicleState?: string
  serviceDetails?: ServiceDetails
  customerComment?: string
  customerId?: string
  customerName?: string
  customerCoordinates?: {
    lat: number
    lng: number
  }
  destinationCoordinates?: {
    lat: number
    lng: number
  }
  assignedProviderId?: string
  assignedOfferId?: string
  partnerId?: string
  partnerProposedPrice?: number
  partnerPriceNote?: string
  providerName?: string
  acceptedAt?: string
  acceptedIdleExpiresAt?: string
  acceptedIdleTimeoutSeconds?: number
  priceConfirmedAt?: string
  cancelReason?: string
  cancelledAt?: string
  assignedProvider?: ProviderAvailability & {
    distanceKm?: number
    etaMinutes?: number
  }
  customerReview?: OrderReview
  partnerReview?: OrderReview
  dispatchState?: string
  dispatchInfo?: {
    eligibleProviders?: number
    offersSent?: number
    offersSentThisWave?: number
    searchRadiusKm?: number
    searchRadiusStepsKm?: number[]
    serviceInitialRadiusKm?: number
    offerTimeoutSeconds?: number
    lastDispatchAt?: string
    autoRetryCount?: number
    lastAutoRetryAt?: string
    exhaustedAt?: string
    wave?: number
    nextWaveAt?: string
    awaitingDispatcher?: boolean
    clientStatusHint?: string
  }
  offers?: DispatchOffer[]
  statusHistory?: Array<{ status: string; at: string }>
  dispatchEvents?: Array<Record<string, unknown> & { type?: string; at?: string; message?: string; providerId?: string; offerId?: string; code?: string }>
}

export interface OrderReview {
  rating: number
  comment?: string
  at?: string
  authorId?: string | null
  authorRole?: 'customer' | 'partner'
}

export interface TelegramSessionResponse {
  chatId?: string
  service?: string
  location?: {
    latitude: number
    longitude: number
  }
  customerId?: string
  profile?: CustomerProfile
  customerIdentity?: CustomerIdentity
  updatedAt?: string
}

export interface AuthSession {
  role: 'admin' | 'provider' | 'customer'
  subjectId: string
  providerId?: string
  customerId?: string
  username?: string
  tokenType: 'Bearer'
  accessToken: string
  expiresAt: number
  profile?: CustomerProfile
  customerIdentity?: CustomerIdentity
  account?: UserAccountStatus
  preferredRole?: 'customer' | 'provider' | ''
  telegramBotKind?: 'customer' | 'provider'
  providerAccount?: {
    linked: boolean
    providerId?: string | null
    verificationStatus?: VerificationStatus | string
  }
}

export interface UserAccountStatus {
  customerId: string
  preferredRole: 'customer' | 'provider' | ''
  linkedProviderId: string
  rolesRegistered: Array<'customer' | 'provider'>
  clientRegistered: boolean
  providerRegistered: boolean
  needsOnboarding: boolean
  profile?: CustomerProfile
}

export type ProviderStatus = 'online' | 'busy' | 'offline'

export type OfferStatus = 'pending' | 'accepted' | 'declined' | 'expired' | 'lost' | 'cancelled'

export type VerificationStatus = 'unverified' | 'pending' | 'verified' | 'rejected'

export interface VerificationDetails {
  phone?: boolean
  email?: boolean
  telegram?: boolean
  identityDocument?: boolean
  driverLicense?: boolean
  vehicleRegistration?: boolean
  serviceProof?: boolean
  selfieCheck?: boolean
  profilePhoto?: boolean
  trustedContacts?: boolean
  backgroundCheck?: string
  submittedAt?: string | null
  reviewedAt?: string | null
  reviewedBy?: string | null
  reviewNote?: string
  [key: string]: unknown
}

export interface CustomerProfile {
  id: string
  name: string
  phone?: string
  email?: string
  telegram?: string
  city?: string
  vehicle?: string
  avatarUrl?: string
  bio?: string
  rating?: number
  ordersCompleted?: number
  verificationStatus?: VerificationStatus
  verification?: VerificationDetails
  trustedBadges?: string[]
  profileCompleteness?: number
  preferredRole?: 'customer' | 'provider' | ''
  linkedProviderId?: string
  rolesRegistered?: Array<'customer' | 'provider'>
  createdAt?: string
  updatedAt?: string
  displayName?: string
  clientRegistered?: boolean
  isGuestSession?: boolean
}

export interface CustomerIdentity {
  type: 'telegram' | 'guest'
  telegramUserId?: string
  username?: string
  firstName?: string
  lastName?: string
  customerId?: string
}

export interface DispatchOffer {
  id: string
  orderId: string
  providerId: string
  status: OfferStatus
  /** Parent order status — used to hide stale offers for completed/cancelled orders. */
  orderStatus?: string
  distanceKm?: number
  createdAt?: string
  expiresAt?: string
  respondedAt?: string
  service?: string
  vehicleState?: string
  serviceDetails?: ServiceDetails
  approximateLocation?: string
  customerComment?: string
  customerCoordinates?: {
    lat: number
    lng: number
  }
  etaMinutes?: number
}

export interface ProviderAvailability {
  id: string
  name: string
  rating?: number
  ratingCount?: number
  vehicle?: string
  vehicleMake?: string
  vehicleModel?: string
  plate?: string
  phone?: string
  telegram?: string
  status: ProviderStatus
  etaMinutes?: number
  location?: {
    lat: number
    lng: number
  }
  address?: string
  city?: string
  website?: string
  openingHours?: string
  contactStatus?: 'phone' | 'directory_only'
  primarySpecialty?: string
  providerKind?: 'dispatch' | 'directory'
  source?: string
  specialties?: string[]
  serviceRadiusKm?: number
  registeredAt?: string
  profileUpdatedAt?: string
  lastSeenAt?: string
  lastLocationAt?: string
  assignedOrderId?: string
  verificationStatus?: VerificationStatus
  verification?: VerificationDetails
  trustedBadges?: string[]
  updatedAt?: string
  distanceKm?: number
  ordersCompleted?: number
}

export interface ProviderPublicReview {
  rating: number
  comment?: string
  at?: string
  service?: string
}

export interface ProviderPublicProfile {
  id: string
  name: string
  rating?: number
  ratingCount?: number
  vehicle?: string
  specialties?: string[]
  status?: ProviderStatus
  etaMinutes?: number
  providerKind?: 'dispatch' | 'directory' | string
  city?: string
  address?: string
  phone?: string
  telegram?: string
  verificationStatus?: VerificationStatus
  openingHours?: string
  website?: string
  ordersCompleted?: number
  location?: {
    lat: number
    lng: number
  }
  reviews: ProviderPublicReview[]
}

export interface MapRequestPin {
  id: string
  offerId?: string
  service?: string
  status?: string
  customerLocation?: string
  vehicleState?: string
  serviceDetails?: ServiceDetails
  customerComment?: string
  customerCoordinates?: {
    lat: number
    lng: number
  }
  distanceKm?: number
  etaMinutes?: number
  phone?: string
}

export interface MapSettlement {
  id: string
  name: string
  oblast?: string
  type?: string
  center?: { lat: number; lng: number }
  bbox?: [number, number, number, number]
}

export interface CustomerVerifySendResponse {
  ok: boolean
  channel: 'telegram' | 'email'
  expiresAt: string
  expiresInSeconds: number
  cooldownSeconds?: number
  alreadySent?: boolean
  alreadyVerified?: boolean
  sent?: boolean
  devCode?: string
  profile?: CustomerProfile
}

export interface CustomerVerifyConfirmResponse {
  ok: boolean
  profile: CustomerProfile
}

export interface AdminStats {
  totals: {
    clients: number
    providers: number
    dispatchProviders: number
    directoryProviders: number
    orders: number
    activeOrders: number
    completedOrders: number
  }
  providers: {
    online: number
    busy: number
    offline: number
    verified: number
    pendingVerification: number
  }
  clients: {
    verified: number
    registered: number
    disabled: number
  }
  orders: {
    searching: number
    assigned: number
    enRoute: number
    inProgress: number
  }
  activity?: AdminActivityItem[]
}

export interface AdminActivityItem {
  type: string
  id?: string
  status?: string
  service?: string
  source?: string
  customerLocation?: string
  assignedProviderId?: string
  at?: string
}

export interface AdminOpsLogEvent {
  id?: string
  type: string
  at?: string
  severity?: 'error' | 'warn' | 'info' | string
  source?: string
  message?: string
  orderId?: string
  providerId?: string
  customerId?: string
  offerId?: string
  code?: string
  orderStatus?: string
  service?: string
}

export interface AdminOpsLog {
  events: AdminOpsLogEvent[]
  counts: { error: number; warn: number; info: number; total: number }
  limit: number
}

export interface AdminSettings {
  runtime: string
  webAppUrl?: string | null
  corsOrigins: string[]
  encryptionEnabled: boolean
  databaseUrlConfigured: boolean
  telegramConfigured: boolean
  adminAccountsConfigured: boolean
  providerAccountsConfigured: boolean
  allowHttpPilot: boolean
  sessionTtlSeconds: number
}
