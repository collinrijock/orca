import type {
  SessionOptionDescriptor,
  SessionOptionSelectChoice
} from '../../../../shared/native-chat-session-options'
import { translate } from '@/i18n/i18n'

export function nativeChatSessionOptionLabel(descriptor: SessionOptionDescriptor): string {
  switch (descriptor.id) {
    case 'model':
      return translate('components.native-chat.composer.model', 'Model')
    case 'effort':
      return translate('components.native-chat.composer.effort', descriptor.label)
    case 'fastMode':
      return translate('components.native-chat.composer.fastMode', 'Fast mode')
    case 'thinking':
      return translate('components.native-chat.composer.thinking', 'Thinking')
    default:
      return descriptor.label
  }
}

export function nativeChatSessionChoiceLabel(choice: SessionOptionSelectChoice): string {
  switch (choice.value) {
    case 'minimal':
      return translate('components.native-chat.composer.optionValue.minimal', 'Minimal')
    case 'low':
      return translate('components.native-chat.composer.optionValue.low', 'Low')
    case 'medium':
      return translate('components.native-chat.composer.optionValue.medium', 'Medium')
    case 'high':
      return translate('components.native-chat.composer.optionValue.high', 'High')
    case 'xhigh':
      return translate('components.native-chat.composer.optionValue.xhigh', 'Extra high')
    case 'max':
      return translate('components.native-chat.composer.optionValue.max', 'Max')
    default:
      return choice.label
  }
}

export function nativeChatSessionOptionDisabledReason(reason: string | undefined): string | null {
  if (reason === 'Set when the session starts.') {
    return translate(
      'components.native-chat.composer.setWhenSessionStarts',
      'Set when the session starts.'
    )
  }
  if (reason === 'Available after the session starts.') {
    return translate(
      'components.native-chat.composer.availableAfterSessionStarts',
      'Available after the session starts.'
    )
  }
  return reason ?? null
}

export function nativeChatModelPillLabel(descriptor: SessionOptionDescriptor): string {
  if (descriptor.valueSource === 'unknown' || descriptor.kind.type !== 'select') {
    return translate('components.native-chat.composer.model', 'Model')
  }
  return nativeChatSessionChoiceLabel(
    descriptor.kind.choices.find((choice) => choice.value === descriptor.kind.currentValue) ?? {
      value: descriptor.kind.currentValue ?? '',
      label: descriptor.kind.currentValue ?? ''
    }
  )
}

export function nativeChatOptionsPillLabel(
  descriptors: readonly SessionOptionDescriptor[]
): string {
  const labels: string[] = []
  for (const descriptor of descriptors) {
    if (descriptor.valueSource === 'unknown') {
      continue
    }
    if (descriptor.kind.type === 'select' && descriptor.kind.currentValue) {
      const choice = descriptor.kind.choices.find(
        (candidate) => candidate.value === descriptor.kind.currentValue
      )
      labels.push(
        nativeChatSessionChoiceLabel(
          choice ?? {
            value: descriptor.kind.currentValue,
            label: descriptor.kind.currentValue
          }
        )
      )
    } else if (descriptor.kind.type === 'boolean' && descriptor.kind.currentValue === true) {
      labels.push(
        descriptor.id === 'fastMode'
          ? translate('components.native-chat.composer.optionValue.fast', 'Fast')
          : nativeChatSessionOptionLabel(descriptor)
      )
    }
  }
  return labels.length > 0
    ? labels.join(' · ')
    : translate('components.native-chat.composer.options', 'Options')
}
