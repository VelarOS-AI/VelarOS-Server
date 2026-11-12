import { useState } from 'react'
import { Button } from '@velaros-ai/ui/primitives/buttons/Button'
import {
  BusinessCascadingMenu,
  BusinessCascadingMenuItem,
} from '@velaros-ai/ui/product/menus/BusinessCascadingMenu'
import type { ExecutionMode } from '../../../packages/contracts/src/index.js'

const choices: { id: ExecutionMode; label: string; description: string }[] = [
  { id: 'standard', label: '标准模式', description: '工作区内自动执行；不可恢复的操作先确认。' },
  {
    id: 'full',
    label: '完全访问',
    description: '使用服务账户的主机权限，不启用工作区沙箱，自动批准执行。',
  },
  { id: 'ask', label: '每次询问', description: '保留工作区沙箱，每次执行程序前确认。' },
]

export function ExecutionModeSelector({
  value,
  onChange,
  disabled,
}: {
  value: ExecutionMode
  onChange(value: ExecutionMode): void
  disabled: boolean
}): React.ReactElement {
  const [open, setOpen] = useState(false)
  return (
    <BusinessCascadingMenu
      open={open}
      onOpenChange={setOpen}
      activeSubmenuId={null}
      onActiveSubmenuChange={() => {}}
      side="top"
      align="end"
      sideOffset={8}
      anchor={({ getAnchorProps }) => (
        <Button
          {...getAnchorProps({ disabled })}
          variant="ghost"
          size="sm"
          className="model-button"
          aria-label="执行模式"
          title="执行模式"
          disabled={disabled}
        >
          <span>{choices.find((item) => item.id === value)!.label}</span>
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            aria-hidden="true"
          >
            <path d="m7 10 5 5 5-5" />
          </svg>
        </Button>
      )}
    >
      {(menu) => (
        <div {...menu.getPrimaryPanelProps({ className: 'execution-mode-menu' })}>
          {choices.map((choice) => (
            <BusinessCascadingMenuItem
              key={choice.id}
              menu={menu}
              selected={value === choice.id}
              onClick={() => {
                onChange(choice.id)
                menu.close()
              }}
            >
              <span
                className="execution-mode-choice"
                data-danger={choice.id === 'full' || undefined}
              >
                <span>{choice.label}</span>
                <small>{choice.description}</small>
              </span>
            </BusinessCascadingMenuItem>
          ))}
        </div>
      )}
    </BusinessCascadingMenu>
  )
}
