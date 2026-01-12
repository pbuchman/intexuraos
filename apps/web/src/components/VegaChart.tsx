import { useEffect, useRef } from 'react';
import embed from 'vega-embed';
import type { CompositeFeedData } from '@/types';

interface VegaChartProps {
  spec: object;
  data: CompositeFeedData;
  onRenderError?: (error: Error) => void;
}

export function VegaChart({ spec, data, onRenderError }: VegaChartProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (containerRef.current === null) {
      return;
    }

    const container = containerRef.current;
    const specWithData = replaceDataPlaceholder(spec, data);

    void embed(container, specWithData, {
      actions: false,
      renderer: 'canvas',
    })
      .then(() => {
        // nop
      })
      .catch((error: unknown) => {
        const err = error instanceof Error ? error : new Error(String(error));
        onRenderError?.(err);
      });

    return (): void => {
      container.innerHTML = '';
    };
  }, [spec, data, onRenderError]);

  return <div ref={containerRef} className="w-full" />;
}

function replaceDataPlaceholder(spec: object, data: CompositeFeedData): object {
  const specStr = JSON.stringify(spec);
  const replaced = specStr.replace(/"name"\s*:\s*"\$DATA"/g, `"values":${JSON.stringify(data)}`);
  return JSON.parse(replaced) as object;
}
