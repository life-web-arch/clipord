import type { ClipType } from './types'

const URL_REGEX     = /^(https?:\/\/)?([\w-]+\.)+[\w-]+(\/\S*)?$/i
const OTP_REGEX     = /\b\d{4,8}\b/
const PHONE_REGEX   = /(\+?\d[\d\s\-().]{7,}\d)/
const ADDRESS_REGEX = /\d{1,5}\s[\w\s]{2,30}(street|st|avenue|ave|road|rd|boulevard|blvd|lane|ln|drive|dr|court|ct|way|place|pl)\b/i
const CODE_REGEX    = /(`{3}[\s\S]*`{3})|(^\s*(import|export|function|const|let|var|class|def|return|if|for|while)\s)/m

export function detectClipType(content: string): ClipType {
  const trimmed = content.trim()
  if (URL_REGEX.test(trimmed))                          return 'url'
  if (OTP_REGEX.test(trimmed) && trimmed.length < 12)  return 'otp'
  if (PHONE_REGEX.test(trimmed))                        return 'phone'
  if (ADDRESS_REGEX.test(trimmed))                      return 'address'
  if (CODE_REGEX.test(trimmed))                         return 'code'
  return 'text'
}

export function generatePreview(content: string, maxLength = 80): string {
  const trimmed = content.trim().replace(/\s+/g, ' ')
  if (trimmed.length <= maxLength) return trimmed
  return trimmed.slice(0, maxLength) + '...'
}

export function getClipTypeLabel(type: ClipType): string {
  const labels: Record<ClipType, string> = {
    url:     'URL',
    otp:     'OTP / Code',
    phone:   'Phone',
    address: 'Address',
    code:    'Code',
    text:    'Text',
  }
  return labels[type]
}

export function getClipTypeIcon(type: ClipType): string {
  const icons: Record<ClipType, string> = {
    url:     '🔗',
    otp:     '🔑',
    phone:   '📞',
    address: '📍',
    code:    '💻',
    text:    '📝',
  }
  return icons[type]
}

export function maskSensitiveContent(content: string, type: ClipType): string {
  if (type === 'otp') {
    return content.replace(/\d/g, '•')
  }
  return content
}
