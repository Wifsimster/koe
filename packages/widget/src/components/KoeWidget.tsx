import { useState, useEffect } from 'react';
import type { WidgetConfig } from '@koe/shared';
import { KoeProvider } from '../context/KoeContext';
import { Launcher } from './Launcher';
import { Panel } from './Panel';
import { positionToClasses, themeVars } from '../theme';
import clsx from 'clsx';
import { useTrail } from '../capture';

export interface KoeWidgetProps extends WidgetConfig {
  defaultOpen?: boolean;
}

export function KoeWidget(props: KoeWidgetProps) {
  const { defaultOpen = false, ...config } = props;
  const [open, setOpen] = useState(defaultOpen);
  useTrail(config);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const position = config.position ?? 'bottom-right';
  const mode = config.theme?.mode ?? 'auto';

  return (
    <KoeProvider config={config}>
      <div
        className={clsx('koe-root koe-fixed koe-z-[2147483000]', positionToClasses(position))}
        data-mode={mode}
        data-open={open ? 'true' : 'false'}
        style={themeVars(config.theme)}
      >
        {open && <Panel onClose={() => setOpen(false)} />}
        {!open && <Launcher open={open} onToggle={() => setOpen((v) => !v)} />}
      </div>
    </KoeProvider>
  );
}
