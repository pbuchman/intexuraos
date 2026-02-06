interface JsonViewProps {
  data: unknown;
}

function formatValue(value: unknown, indent: number): React.JSX.Element {
  const indentStr = '  '.repeat(indent);

  if (value === null) {
    return <span className="text-slate-500">null</span>;
  }

  if (typeof value === 'boolean') {
    return <span className="text-purple-400">{String(value)}</span>;
  }

  if (typeof value === 'number') {
    return <span className="text-amber-400">{String(value)}</span>;
  }

  if (typeof value === 'string') {
    if (value.length > 100) {
      return <span className="text-emerald-400">"{value.slice(0, 100)}..."</span>;
    }
    return <span className="text-emerald-400">"{value}"</span>;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return <span className="text-slate-400">[]</span>;
    }
    return (
      <span>
        <span className="text-slate-400">[</span>
        {value.map((item, i) => (
          <div key={i} className="ml-4">
            {formatValue(item, indent + 1)}
            {i < value.length - 1 && <span className="text-slate-500">,</span>}
          </div>
        ))}
        <span className="text-slate-400">{indentStr}]</span>
      </span>
    );
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value);
    if (entries.length === 0) {
      return <span className="text-slate-400">{'{}'}</span>;
    }
    return (
      <span>
        <span className="text-slate-400">{'{'}</span>
        {entries.map(([key, val], i) => (
          <div key={key} className="ml-4">
            <span className="text-blue-400">"{key}"</span>
            <span className="text-slate-500">: </span>
            {formatValue(val, indent + 1)}
            {i < entries.length - 1 && <span className="text-slate-500">,</span>}
          </div>
        ))}
        <span className="text-slate-400">{indentStr}{'}'}</span>
      </span>
    );
  }

  return <span className="text-slate-400">{JSON.stringify(value)}</span>;
}

export function JsonView({ data }: JsonViewProps): React.JSX.Element {
  return (
    <pre className="font-mono text-xs leading-relaxed overflow-x-auto">
      {formatValue(data, 0)}
    </pre>
  );
}
