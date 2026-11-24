import * as React from 'react';
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import styles from './AiWritten.module.scss';

void React;

const Registration = createContext<((block: Element) => () => void) | null>(null);

type MarkedElement = 'span' | 'div' | 'p' | 'li' | 'h2' | 'h3' | 'pre';

export function isAiWritten(source: { aiWrittenFields?: unknown } | Record<string, unknown> | undefined, field: string): boolean {
  return Array.isArray(source?.aiWrittenFields) && source.aiWrittenFields.includes(field);
}

export function AiWritten({
  as: Element = 'span',
  authored,
  children,
  className,
  style,
  title,
}: {
  as?: MarkedElement;
  authored: boolean;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  title?: string;
}) {
  const register = useContext(Registration);
  const label = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const block = label.current?.parentElement;
    if (authored && block && register) return register(block);
  }, [authored, register, Element]);

  return (
    <Element className={className} style={style} title={title} data-ai-generated={authored ? 'true' : undefined}>
      {authored && (typeof children === 'string' || typeof children === 'number') ? <span>{children}</span> : children}
      {authored && <> <span ref={label} className={styles.label} data-text="other">AI-written</span></>}
    </Element>
  );
}

const selector = '[data-ai-generated="true"]';
const metaName = 'ai-generated-content';

function isDisplayed(block: Element): boolean {
  if (block.closest('[hidden], [aria-hidden="true"], [inert]')) return false;
  for (let parent = block.parentElement; parent; parent = parent.parentElement) {
    if (parent instanceof HTMLDetailsElement && !parent.open) {
      const summary = parent.querySelector(':scope > summary');
      if (!summary?.contains(block)) return false;
    }
  }
  return block.getClientRects().length > 0 && getComputedStyle(block).visibility === 'visible';
}

export function AiWrittenPage({ children }: { children: ReactNode }) {
  const blocks = useRef(new Set<Element>());
  const schedule = useRef<() => void>(() => undefined);
  const register = useCallback((block: Element) => {
    blocks.current.add(block);
    schedule.current();
    return () => {
      blocks.current.delete(block);
      schedule.current();
    };
  }, []);

  useEffect(() => {
    const content = document.createElement('meta');
    content.name = metaName;
    content.content = 'partial';
    let frame = 0;
    const refresh = () => {
      frame = 0;
      const displayed = Array.from(blocks.current).some(isDisplayed);
      if (displayed && !content.isConnected) document.head.append(content);
      if (!displayed && content.isConnected) content.remove();
    };
    const queueRefresh = () => {
      if (!frame) frame = requestAnimationFrame(refresh);
    };
    schedule.current = queueRefresh;
    const observer = new MutationObserver(records => {
      const changed = records.some(record => {
        if (record.type === 'attributes') return record.attributeName === 'data-ai-generated'
          || (record.target instanceof Element && Boolean(record.target.querySelector(selector)));
        return [...record.addedNodes, ...record.removedNodes].some(node =>
          node instanceof Element && (node.matches(selector) || node.querySelector(selector)));
      });
      if (changed) queueRefresh();
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-ai-generated', 'hidden', 'aria-hidden', 'inert', 'open', 'style', 'class'],
    });
    window.addEventListener('resize', queueRefresh);
    refresh();
    return () => {
      schedule.current = () => undefined;
      observer.disconnect();
      window.removeEventListener('resize', queueRefresh);
      cancelAnimationFrame(frame);
      content.remove();
    };
  }, []);

  return <Registration.Provider value={register}>{children}</Registration.Provider>;
}
