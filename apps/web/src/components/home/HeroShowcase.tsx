import {
  BellRing,
  Bookmark,
  Calendar,
  Check,
  CheckSquare,
  ChevronDown,
  ChevronUp,
  Code2,
  Database,
  ExternalLink,
  RadioTower,
  Inbox,
  LayoutList,
  List,
  Loader2,
  MessageSquare,
  Moon,
  Play,
  Plus,
  ScrollText,
  Server,
  Settings,
  Sparkles,
  StickyNote,
  User,
} from 'lucide-react';
import type React from 'react';

/*
 * WhatsApp Brand Colors (used as Tailwind arbitrary values below):
 *   Header:      #075e54
 *   User bubble: #dcf8c6
 *   Chat bg:     #ece5dd
 *   Action:      #00a884
 */

// --- Sidebar Item ---

function SbItem({ icon: Icon, label, active, chevron }: {
  icon: React.ElementType;
  label: string;
  active?: boolean;
  chevron?: 'up' | 'down';
}): React.JSX.Element {
  const Chevron = chevron === 'up' ? ChevronUp : ChevronDown;
  return (
    <div className={`flex items-center gap-2 px-3 py-1 text-[11px] font-medium ${active === true ? 'border-l-2 border-blue-500 bg-blue-50 font-semibold text-blue-700' : 'border-l-2 border-transparent text-slate-500'}`}>
      <Icon className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate">{label}</span>
      {chevron !== undefined && <Chevron className="ml-auto h-3 w-3 text-slate-400" />}
    </div>
  );
}

function SbSub({ icon: Icon, label, active }: {
  icon: React.ElementType;
  label: string;
  active?: boolean;
}): React.JSX.Element {
  return (
    <div className={`ml-6 flex items-center gap-2 border-l border-slate-200 py-0.5 pl-2 text-[10px] font-medium ${active === true ? 'rounded-r bg-blue-50 text-blue-700' : 'text-slate-400'}`}>
      <Icon className="h-3 w-3 shrink-0" />
      <span>{label}</span>
    </div>
  );
}

// --- Pipeline Dot ---

function Dot({ state }: { state: 'done' | 'run' | 'wait' | 'action' }): React.JSX.Element {
  if (state === 'done') {
    return <span className="flex h-[14px] w-[14px] items-center justify-center rounded-full bg-emerald-500/15"><Check className="h-2.5 w-2.5 text-emerald-500" /></span>;
  }
  if (state === 'run') {
    return <span className="flex h-[14px] w-[14px] items-center justify-center rounded-full bg-blue-500/15"><Loader2 className="h-2.5 w-2.5 animate-spin text-blue-500" /></span>;
  }
  if (state === 'action') {
    return <span className="flex h-[14px] w-[14px] items-center justify-center rounded-full bg-green-500/15"><Play className="h-2.5 w-2.5 fill-green-500 text-green-500" /></span>;
  }
  return <span className="flex h-[14px] w-[14px] items-center justify-center rounded-full bg-slate-500/15"><span className="h-1.5 w-1.5 rounded-full bg-slate-400" /></span>;
}

function PipeConn(): React.JSX.Element {
  return <span className="mx-0.5 h-px w-2 bg-slate-300" />;
}

// --- Task Row ---

function TaskRow({ issueId, title, pipeline, time, output, accent }: {
  issueId: string;
  title: string;
  pipeline: React.ReactNode;
  time: React.ReactNode;
  output: React.ReactNode;
  accent?: 'blue' | 'green';
}): React.JSX.Element {
  const shadow = accent === 'blue' ? 'shadow-[inset_3px_0_0_theme(colors.blue.500)]' : accent === 'green' ? 'shadow-[inset_3px_0_0_theme(colors.green.500)]' : '';
  return (
    <div className={`grid grid-cols-[1fr_1fr_80px_70px_20px] items-center gap-1 rounded-lg border border-slate-200 px-2 py-1.5 text-[9px] ${shadow}`}>
      <div className="flex items-center gap-1 overflow-hidden">
        <ChevronDown className="h-2.5 w-2.5 shrink-0 rotate-[-90deg] text-slate-400" />
        <div className="min-w-0">
          <div className="font-mono text-[10px] font-medium text-blue-500">{issueId}</div>
          <div className="truncate text-slate-500">{title}</div>
        </div>
      </div>
      <div className="flex items-center">{pipeline}</div>
      <div className="text-slate-400 leading-relaxed">{time}</div>
      <div className="flex items-center justify-end">{output}</div>
      <div className="flex items-center justify-center">
        <ScrollText className="h-2.5 w-2.5 text-slate-400" />
      </div>
    </div>
  );
}

// --- WhatsApp Message Components ---

function WaUser({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <div className="max-w-[88%] self-end rounded-md rounded-tr-none bg-[#dcf8c6] px-2 py-1 text-[9px] leading-relaxed">{children}</div>;
}

function WaBot({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <div className="max-w-[88%] self-start rounded-md rounded-tl-none bg-white px-2 py-1 text-[9px] leading-relaxed">{children}</div>;
}

function WaTime({ children, align }: { children: React.ReactNode; align?: 'left' | 'right' }): React.JSX.Element {
  return <div className={`mt-0.5 text-[7px] text-neutral-400 ${align === 'left' ? 'text-left' : 'text-right'}`}>{children}</div>;
}

function WaBtn({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <div className="mt-1 border-t border-neutral-200 pt-1 text-center text-[9px] font-semibold text-[#00a884]">{children}</div>;
}

// --- Main Component ---

export function HeroShowcase(): React.JSX.Element {
  return (
    <div className="flex items-start justify-center gap-5">

      {/* ─── Dashboard ─── */}
      <div className="hidden flex-1 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg md:block">
        {/* Browser chrome */}
        <div className="flex items-center gap-2 border-b border-slate-200 bg-white px-3 py-1.5">
          <div className="flex gap-1"><span className="h-2 w-2 rounded-full bg-red-300" /><span className="h-2 w-2 rounded-full bg-amber-300" /><span className="h-2 w-2 rounded-full bg-green-300" /></div>
          <div className="flex-1 rounded bg-slate-50 border border-slate-200 px-2 py-0.5 font-mono text-[9px] text-slate-500">
            <span className="text-emerald-600 mr-1">&#128274;</span>intexuraos.cloud
          </div>
        </div>

        {/* App header */}
        <div className="flex items-center justify-between border-b border-slate-200 px-3 py-1.5">
          <div className="flex items-center gap-1.5">
            <div className="flex h-5 w-5 items-center justify-center rounded bg-gradient-to-br from-cyan-500 to-blue-600">
              <span className="text-[10px] font-black text-white">I</span>
            </div>
            <span className="text-[11px] font-bold text-slate-900">IntexuraOS</span>
            <span className="text-[8px] text-slate-400">ver. 3.3.0</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="flex items-center gap-1">
              <Server className="h-3 w-3 text-slate-500" />
              <span className="h-2 w-2 rounded-full bg-green-500" />
            </div>
            <Moon className="h-3.5 w-3.5 text-slate-400" />
            <div className="flex items-center gap-1">
              <div className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-200">
                <User className="h-3 w-3 text-slate-500" />
              </div>
              <span className="text-[10px] font-medium text-slate-600">Piotr</span>
              <ChevronDown className="h-2.5 w-2.5 text-slate-400" />
            </div>
          </div>
        </div>

        {/* Content area */}
        <div className="flex min-h-[280px]">
          {/* Sidebar */}
          <div className="w-[130px] shrink-0 border-r border-slate-100 py-1.5">
            <SbItem icon={Inbox} label="Inbox" />
            <div className="h-1" />
            <SbItem icon={Code2} label="Code Tasks" active chevron="up" />
            <SbSub icon={List} label="Battlefield" active />
            <SbSub icon={Plus} label="New Task" />
            <SbSub icon={RadioTower} label="GitHub Event Log" />
            <div className="h-1" />
            <SbItem icon={Sparkles} label="Research Studio" chevron="down" />
            <div className="h-1" />
            <SbItem icon={Database} label="Data Insights" chevron="down" />
            <SbItem icon={LayoutList} label="Linear Issues" />
            <SbItem icon={Calendar} label="Calendar" />
            <SbItem icon={Bookmark} label="Bookmarks" />
            <SbItem icon={MessageSquare} label="WhatsApp" />
            <div className="h-1" />
            <SbItem icon={BellRing} label="Mobile" chevron="down" />
            <SbItem icon={StickyNote} label="Notes" />
            <SbItem icon={CheckSquare} label="Checklists" />
            <div className="h-1" />
            <SbItem icon={Settings} label="Settings" chevron="down" />
          </div>

          {/* Main */}
          <div className="flex-1 p-3">
            {/* Page header */}
            <div className="mb-2 flex items-center justify-between">
              <div>
                <div className="text-sm font-bold text-slate-900">Code Tasks</div>
                <div className="text-[8px] text-slate-400">4 issues · 1 needs attention · 0 failed</div>
              </div>
              <div className="flex items-center gap-1 rounded-md bg-blue-500 px-2 py-0.5 text-[9px] font-semibold text-white">
                <Plus className="h-2.5 w-2.5" /> New Task
              </div>
            </div>

            {/* Filter pills */}
            <div className="mb-2 flex gap-1">
              {[
                { label: 'Active', count: '2', color: 'bg-blue-500', active: true },
                { label: 'Needs Action', count: '1', color: 'bg-green-500' },
                { label: 'Done', count: '47', color: 'bg-emerald-500' },
                { label: 'Failed', count: '0', color: 'bg-red-500' },
                { label: 'Archived', count: '12', color: 'bg-slate-400' },
              ].map((p, idx) => (
                <div key={idx} className={`flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[8px] font-semibold ${p.active === true ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-500'}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${p.color}`} />
                  {p.label} <span className="opacity-50">{p.count}</span>
                </div>
              ))}
            </div>

            {/* Column headers */}
            <div className="mb-1 grid grid-cols-[1fr_1fr_80px_70px_20px] gap-1 px-2 text-[7px] font-semibold uppercase tracking-wider text-slate-400">
              <span>Issue</span><span>Pipeline</span><span>Time</span><span className="text-right">Output</span><span />
            </div>

            {/* Task rows */}
            <div className="space-y-1">
              <TaskRow
                issueId="INT-937"
                title="Resolve merge conflicts on PR #1237"
                accent="blue"
                pipeline={<><Dot state="done" /><span className="ml-0.5 text-slate-500">Plan</span><PipeConn /><Dot state="run" /><span className="ml-0.5 text-slate-500">Execute...</span><PipeConn /><Dot state="wait" /></>}
                time={<><span className="text-slate-500">Created</span> 4m ago<br /><span className="text-slate-500">Started</span> 2m ago</>}
                output={<span className="inline-flex rounded-full border border-blue-200 bg-blue-50 p-1"><Loader2 className="h-2.5 w-2.5 animate-spin text-blue-500" /></span>}
              />
              <TaskRow
                issueId="INT-936"
                title="Remove legacy V1 CodeTaskViewPage"
                pipeline={<><Dot state="done" /><PipeConn /><Dot state="done" /><PipeConn /><Dot state="done" /><span className="ml-0.5 text-slate-500">#1260</span></>}
                time={<><span className="text-slate-500">Created</span> 2h ago<br /><span className="text-slate-500">Started</span> 2h ago</>}
                output={<span className="inline-flex items-center gap-0.5 rounded-full border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-[8px] font-semibold text-blue-600"><ExternalLink className="h-2 w-2" />#1260</span>}
              />
              <TaskRow
                issueId="INT-935"
                title="Streamline mobile chat bottom sheet"
                accent="green"
                pipeline={<><Dot state="done" /><span className="ml-0.5 text-slate-500">Plan</span><PipeConn /><Dot state="action" /><span className="ml-0.5 text-green-600">Implement</span></>}
                time={<><span className="text-slate-500">Created</span> 5h ago<br /><span className="text-slate-500">Started</span> Pending</>}
                output={<span className="inline-flex items-center gap-0.5 rounded bg-green-600 px-1.5 py-0.5 text-[8px] font-semibold text-white"><Play className="h-2 w-2 fill-white" />Implement</span>}
              />
              <TaskRow
                issueId="INT-934"
                title="Add horizontal scrolling for mobile logs"
                pipeline={<><Dot state="done" /><PipeConn /><Dot state="done" /><PipeConn /><Dot state="done" /><span className="ml-0.5 text-slate-500">#1258</span></>}
                time={<><span className="text-slate-500">Created</span> 1d ago<br /><span className="text-slate-500">Started</span> 1d ago</>}
                output={<span className="inline-flex items-center gap-0.5 rounded-full border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-[8px] font-semibold text-blue-600"><ExternalLink className="h-2 w-2" />#1258</span>}
              />
            </div>
          </div>
        </div>
      </div>

      {/* ─── SYNC Connector ─── */}
      <div className="hidden flex-col items-center justify-center gap-1 self-center md:flex">
        <svg aria-hidden="true" className="h-4 w-4 stroke-slate-300" viewBox="0 0 24 24" fill="none" strokeWidth="2"><path d="M5 12h14M12 5l7 7-7 7" /></svg>
        <span className="text-[8px] font-bold tracking-[3px] text-slate-300 [writing-mode:vertical-lr] rotate-180">SYNC</span>
        <svg aria-hidden="true" className="h-4 w-4 stroke-slate-300" viewBox="0 0 24 24" fill="none" strokeWidth="2"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
      </div>

      {/* ─── WhatsApp Phone ─── */}
      <div className="w-[200px] shrink-0 overflow-hidden rounded-[24px] border-[4px] border-neutral-900 shadow-xl md:w-[200px]">
        {/* Notch */}
        <div className="mx-auto h-4 w-16 rounded-b-xl bg-neutral-900" />
        {/* Status bar */}
        <div className="-mt-4 flex h-4 items-center justify-between px-3 text-[8px] font-semibold text-neutral-500">
          <span>9:41</span>
          <span className="tracking-[-0.5px]">●●●● ▲ 🔋</span>
        </div>
        {/* WA Header */}
        <div className="flex items-center gap-1.5 bg-[#075e54] px-2 py-1.5 text-white">
          <svg aria-hidden="true" className="h-3 w-3 opacity-60" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="15 18 9 12 15 6" /></svg>
          <div className="flex h-5 w-5 items-center justify-center rounded-full bg-gradient-to-br from-cyan-500 to-blue-600">
            <span className="text-[8px] font-black">I</span>
          </div>
          <div>
            <div className="text-[10px] font-semibold">IntexuraOS</div>
            <div className="text-[7px] opacity-60">online</div>
          </div>
        </div>

        {/* Chat area */}
        <div className="flex min-h-[300px] flex-col gap-1 bg-[#ece5dd] p-1.5">
          {/* Voice note */}
          <WaUser>
            <div className="flex items-center gap-1 py-0.5">
              <div className="flex h-4 w-4 items-center justify-center rounded-full bg-[#075e54]">
                <svg aria-hidden="true" className="h-2 w-2 fill-white" viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3" /></svg>
              </div>
              <div className="flex items-center gap-px h-3">
                {[5,12,8,16,6,14,10,4].map((h, i) => (
                  // eslint-disable-next-line no-restricted-syntax -- Dynamic waveform heights computed from array values require inline styles
                  <span key={i} className="w-[2px] rounded-sm bg-[#075e54]" style={{ height: h * 0.7, animationDelay: `${String(i * 0.08)}s` }} />
                ))}
              </div>
              <span className="text-[8px] text-neutral-500">0:06</span>
            </div>
            <WaTime>9:41 AM ✓✓</WaTime>
          </WaUser>

          {/* Transcription */}
          <WaBot>
            <span className="text-[8px]">🎙️ <strong>Transcription:</strong></span><br />
            <span className="text-[8px] italic text-neutral-600">&quot;Resolve merge conflicts on PR 1237&quot;</span>
            <WaTime align="left">9:41 AM</WaTime>
          </WaBot>

          {/* Design ready */}
          <WaBot>
            <span className="text-[8px]">🎨 <strong>INT-937</strong> | Resolve merge conflicts</span><br />
            <span className="text-[8px] text-neutral-500">Identified 3 files with conflicts in auth and routing modules. Ready to implement?</span>
            <WaBtn>▶️ Implement</WaBtn>
            <WaTime align="left">9:43 AM</WaTime>
          </WaBot>

          {/* User taps Implement */}
          <WaUser>
            ▶️ Implement
            <WaTime>9:43 AM ✓✓</WaTime>
          </WaUser>

          {/* Completion */}
          <WaBot>
            <div className="text-[9px] font-bold text-emerald-800">✅ INT-937 | Merge conflicts resolved</div>
            <div className="text-[8px] text-neutral-500">2 commits · fix/conflicts-pr-1237</div>
            <WaBtn>View Pull Request</WaBtn>
            <WaTime align="left">9:47 AM</WaTime>
          </WaBot>
        </div>

        {/* Input bar */}
        <div className="flex items-center gap-1 bg-neutral-200 px-1.5 py-1">
          <div className="flex-1 rounded-full bg-white px-2 py-1 text-[8px] text-neutral-400">Message</div>
          <div className="flex h-5 w-5 items-center justify-center rounded-full bg-[#00a884]">
            <svg aria-hidden="true" className="h-2.5 w-2.5 fill-white" viewBox="0 0 24 24"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" fill="none" stroke="white" strokeWidth="2" /></svg>
          </div>
        </div>
      </div>
    </div>
  );
}
