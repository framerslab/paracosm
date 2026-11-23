import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import styles from './AiWritten.module.scss';

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
}: {
  as?: MarkedElement;
  authored: boolean;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <Element className={className} style={style} data-ai-generated={authored ? 'true' : undefined}>
      {children}
      {authored && <> <span className={styles.label}>AI-written</span></>}
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
  const [content] = useState(() => document.createElement('meta'));

  useEffect(() => {
    content.name = metaName;
    content.content = 'partial';
    let frame = 0;
    const refresh = () => {
      frame = 0;
      const displayed = Array.from(document.querySelectorAll(selector)).some(isDisplayed);
      if (displayed && !content.isConnected) document.head.append(content);
      if (!displayed && content.isConnected) content.remove();
    };
    const queueRefresh = () => {
      if (!frame) frame = requestAnimationFrame(refresh);
    };
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
      observer.disconnect();
      window.removeEventListener('resize', queueRefresh);
      cancelAnimationFrame(frame);
      content.remove();
    };
  }, [content]);

  return children;
}
