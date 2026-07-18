import { X } from 'lucide-react'
import { ShortcutKeyCombo } from '@/components/ShortcutKeyCombo'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useShortcutKeyDetails } from '@/hooks/useShortcutLabel'
import { translate } from '@/i18n/i18n'
import { TAB_CLOSE_BUTTON_BASE_CLASSES, getTabCloseButtonVisibilityClasses } from './drop-indicator'

export function EditorFileTabCloseButton({
  fileIsDirty,
  showsSelectionChrome,
  onClose
}: {
  fileIsDirty: boolean
  showsSelectionChrome: boolean
  onClose: () => void
}): React.JSX.Element {
  const closeShortcut = useShortcutKeyDetails('tab.close')

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          className={`${TAB_CLOSE_BUTTON_BASE_CLASSES} ${getTabCloseButtonVisibilityClasses(showsSelectionChrome)} ${
            fileIsDirty
              ? "after:absolute after:right-0 after:top-0 after:size-1 after:rounded-full after:bg-foreground/60 after:content-['']"
              : ''
          }`}
          type="button"
          // Why: simulator unified tabs reuse this tab chrome, so E2E needs
          // the same stable close affordance on the real button users click.
          data-tab-close-button="true"
          aria-label={translate(
            'auto.components.tab.bar.EditorFileTabCloseButton.4655cf570e',
            'Close tab'
          )}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation()
            onClose()
          }}
        >
          <X className="w-3 h-3" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6} className="flex items-center gap-2">
        <span>
          {translate('auto.components.tab.bar.EditorFileTabCloseButton.a768f428f1', 'Close tab')}
        </span>
        {closeShortcut.keys.length > 0 && (
          <ShortcutKeyCombo keys={closeShortcut.keys} doubleTap={closeShortcut.doubleTap} />
        )}
      </TooltipContent>
    </Tooltip>
  )
}
