import React, { useEffect, useMemo, useState } from "react";
import { initializeApp } from "firebase/app";
import {
  getFirestore,
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { getAuth, signInAnonymously } from "firebase/auth";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  LineChart, Line, ScatterChart, Scatter
} from "recharts";

/**
 * Carts & Mass Experiment — React Single File (Enhanced)
 * Adds:
 * - Hypothesis dropdown on Student form
 * - Experiment Group label (read-only)
 * - Teacher: richer stats (slope/R²), hypothesis tally & % correct, precision leaderboard,
 *   trial strip plot, Cohen's d vs control, CI table per condition
 */

// ---- Firebase client config (yours) ----
const firebaseConfig = {
  apiKey: "AIzaSyAJaWsPWzrP3xx9M5RtagoMlxmtFZYnw_g",
  authDomain: "carts-and-mass-experiment.firebaseapp.com",
  projectId: "carts-and-mass-experiment",
  storageBucket: "carts-and-mass-experiment.firebasestorage.app",
  messagingSenderId: "222036148956",
  appId: "1:222036148956:web:fab678309316fb923b6a19",
  measurementId: "G-WYERZZ8DQD"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth();
signInAnonymously(auth).catch(console.error);

// Teacher gate (optional). Use Vercel env var VITE_TEACHER_KEY for production.
const TEACHER_KEY = import.meta.env?.VITE_TEACHER_KEY || "CLASS-TEACHER-KEY";

const DEFAULT_CONDITIONS = [
  { key: "control", label: "Control (no added mass)" },
  { key: "washers3", label: "3 washers" },
  { key: "bars5", label: "5 bars" },
  { key: "washers3_bars5", label: "3 washers + 5 bars" },
];

function toNumber(v) {
  const n = parseFloat(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}
function mean(arr) {
  const valid = arr.filter((n) => Number.isFinite(n));
  if (!valid.length) return null;
  return valid.reduce((a,b)=>a+b,0)/valid.length;
}
function sd(arr) {
  const valid = arr.filter((n) => Number.isFinite(n));
  if (valid.length < 2) return null;
  const m = mean(valid);
  const v = mean(valid.map(x => (x-m)**2));
  return Math.sqrt(v);
}
function se(arr){
  const s = sd(arr); if (s==null) return null; return s / Math.sqrt(arr.filter(Number.isFinite).length);
}
function ci95(arr){
  const m = mean(arr), s = se(arr);
  if (m==null || s==null) return { lo: null, hi: null };
  const d = 1.96*s; return { lo: m - d, hi: m + d };
}
function linreg(points){
  const n = points.length; if (n < 2) return { slope: 0, intercept: 0, r2: 0 };
  const sx = points.reduce((a,p)=>a+p.x,0);
  const sy = points.reduce((a,p)=>a+p.y,0);
  const sxx = points.reduce((a,p)=>a+p.x*p.x,0);
  const sxy = points.reduce((a,p)=>a+p.x*p.y,0);
  const slope = (n*sxy - sx*sy) / (n*sxx - sx*sx);
  const intercept = (sy - slope*sx)/n;
  const ybar = sy/n;
  const ssTot = points.reduce((a,p)=>a+(p.y-ybar)**2,0);
  const ssRes = points.reduce((a,p)=>a+(p.y-(slope*p.x+intercept))**2,0);
  const r2 = ssTot===0 ? 0 : 1 - ssRes/ssTot;
  return { slope, intercept, r2 };
}
function cohensD(valsC, valsT){
  const mC = mean(valsC), mT = mean(valsT);
  const sC = sd(valsC), sT = sd(valsT);
  const nC = valsC.filter(Number.isFinite).length;
  const nT = valsT.filter(Number.isFinite).length;
  if ([mC,mT,sC,sT].some(v => v==null) || nC<2 || nT<2) return null;
  const sP = Math.sqrt(((nC-1)*sC**2 + (nT-1)*sT**2) / (nC+nT-2));
  if (!Number.isFinite(sP) || sP===0) return null;
  return (mT - mC) / sP;
}

// -------------------- Student Form --------------------
function StudentForm() {
  const [classes, setClasses] = useState([]); // Firestore-powered dropdown
  const [classCode, setClassCode] = useState("");
  const [groupName, setGroupName] = useState("");
  const [members, setMembers] = useState("");
  const [hypothesis, setHypothesis] = useState("increase");
  const [conditions, setConditions] = useState(
    DEFAULT_CONDITIONS.map(c => ({ key: c.key, label: c.label, mass: "", t1: "", t2: "", t3: "" }))
  );
  const [submitted, setSubmitted] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Subscribe to classes collection for dropdown
  useEffect(() => {
    const unsub = onSnapshot(collection(db, "classes"), (snap) => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      list.sort((a,b) => (a.code||"").localeCompare(b.code||""));
      setClasses(list);
    });
    return () => unsub();
  }, []);

  const parsed = useMemo(() => conditions.map(c => {
    const mass = toNumber(c.mass);
    const trials = [toNumber(c.t1), toNumber(c.t2), toNumber(c.t3)];
    return { ...c, mass, trials, avg: mean(trials), sd: sd(trials) };
  }), [conditions]);

  const valid = useMemo(() => {
    if (!classCode || !groupName) return false;
    return parsed.every(p => p.mass !== null && p.trials.every(t => t !== null));
  }, [parsed, classCode, groupName]);

  const chartData = parsed.map(p => ({ condition: p.label, average: p.avg ?? 0 }));

  async function handleSubmit() {
    setBusy(true); setError("");
    try {
      const payload = {
        classCode: classCode.trim().toUpperCase(),
        groupName: groupName.trim(),
        members: members.split(",").map(m => m.trim()).filter(Boolean),
        hypothesis,
        conditions: parsed.map(p => ({ label: p.label, mass: p.mass, trials: p.trials, avg: p.avg, sd: p.sd })),
        createdAt: serverTimestamp(),
      };
      const ref = await addDoc(collection(db, "submissions"), payload);
      setSubmitted(ref.id);
    } catch (e) {
      console.error(e);
      setError("Submission failed. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  if (submitted) {
    return (
      <div className="card">
        <h2 style={{marginTop:0}}>Submitted! Your Results</h2>
        <div className="grid grid-2">
          <div className="card" style={{padding:12}}>
            <strong>Averages by Condition</strong>
            <div style={{height:260}}>
              <ResponsiveContainer>
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="condition" angle={-12} textAnchor="end" height={60} />
                  <YAxis label={{ value: "Distance (m)", angle: -90, position: "insideLeft" }} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="average" name="Avg Distance" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div className="card" style={{padding:12}}>
            <strong>Detailed Trials</strong>
            <div style={{overflowX:"auto"}}>
              <table>
                <thead>
                  <tr>
                    <th>Condition</th><th className="right">Mass (g)</th><th className="right">T1</th><th className="right">T2</th><th className="right">T3</th><th className="right">Avg</th><th className="right">SD</th>
                  </tr>
                </thead>
                <tbody>
                  {parsed.map(p => (
                    <tr key={p.key}>
                      <td>{p.label}</td>
                      <td className="right">{p.mass ?? "–"}</td>
                      <td className="right">{p.trials[0] ?? "–"}</td>
                      <td className="right">{p.trials[1] ?? "–"}</td>
                      <td className="right">{p.trials[2] ?? "–"}</td>
                      <td className="right">{p.avg?.toFixed(3) ?? "–"}</td>
                      <td className="right">{p.sd?.toFixed(3) ?? "–"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="muted">You can close this tab now. Your teacher has the data.</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      <h2 style={{marginTop:0}}>Student Data Entry</h2>
      <div className="grid grid-3">
        <div>
          <label>Class</label>
          <select value={classCode} onChange={(e) => setClassCode(e.target.value)}>
            <option value="">Select your class…</option>
            {classes.map(c => (
              <option key={c.code} value={c.code}>
                {(c.name || c.code)} ({c.code})
              </option>
            ))}
          </select>
          <div className="muted">If your class isn’t listed, ask your teacher to add it on the Teacher tab.</div>
        </div>
        <div>
          <label>Group Name</label>
          <input value={groupName} onChange={e=>setGroupName(e.target.value)} placeholder="Team name" />
        </div>
        <div>
          <label>Members (comma-separated)</label>
          <input value={members} onChange={e=>setMembers(e.target.value)} placeholder="Alex, Bo, Chris" />
        </div>
      </div>

      {/* Hypothesis Row */}
      <div style={{ gridColumn: "1 / -1", marginTop: 8 }}>
        <label>
          Hypothesis: If the mass of the cart increases, then the distance the cart rolls will...
        </label>
        <select value={hypothesis} onChange={(e) => setHypothesis(e.target.value)}>
          <option value="increase">increase</option>
          <option value="decrease">decrease</option>
        </select>
      </div>

      <div className="grid" style={{marginTop:12}}>
        {conditions.map((c, idx) => (
          <div className="card" key={c.key}>
            <div className="grid grid-3">
              <div style={{gridColumn:"span 2"}}>
                <label>Experiment Group</label>
                <input value={c.label} disabled />
              </div>
              <div>
                <label>Cart Mass (g)</label>
                <input value={c.mass} onChange={e=>{
                  const v = e.target.value;
                  setConditions(prev => prev.map((x,i)=> i===idx ? {...x, mass:v} : x));
                }} placeholder="e.g., 250" />
              </div>
              {["t1","t2","t3"].map((tKey, tIdx) => (
                <div key={tKey}>
                  <label>Trial {tIdx+1} Distance (m)</label>
                  <input value={c[tKey]} onChange={e=>{
                    const v = e.target.value;
                    setConditions(prev => prev.map((x,i)=> i===idx ? {...x, [tKey]:v} : x));
                  }} placeholder="e.g., 1.35" />
                </div>
              ))}
            </div>
            <div className="muted" style={{marginTop:6}}>
              Live Avg: {(() => {
                const a = mean([toNumber(c.t1), toNumber(c.t2), toNumber(c.t3)]);
                return a ? a.toFixed(3) + " m" : "–";
              })()} | SD: {(() => {
                const s = sd([toNumber(c.t1), toNumber(c.t2), toNumber(c.t3)]);
                return s ? s.toFixed(3) + " m" : "–";
              })()}
            </div>
          </div>
        ))}
      </div>

      {error && <div style={{color:"#b91c1c", marginTop:8}}>{error}</div>}

      <div className="row" style={{justifyContent:"space-between", marginTop:8}}>
        <div className="muted">All values must be numbers. Use a period for decimals.</div>
        <div style={{display:"flex", flexDirection:"column", gap:6, alignItems:"flex-end"}}>
          <button disabled={!valid || !classCode || busy} onClick={handleSubmit}>{busy? "Submitting…" : "Submit Data"}</button>
          {!classCode && <div className="muted">Select your class to enable submit.</div>}
        </div>
      </div>
    </div>
  );
}

// -------------------- Teacher Dashboard --------------------
function TeacherDashboard() {
  const [key, setKey] = useState("");
  const [authed, setAuthed] = useState(false);

  const [classes, setClasses] = useState([]);
  const [className, setClassName] = useState("");
  const [classCode, setClassCode] = useState("");

  const [submissions, setSubmissions] = useState([]);
  const [active, setActive] = useState("ALL");

  useEffect(() => {
    const unsubC = onSnapshot(collection(db, "classes"), (snap)=>{
      setClasses(snap.docs.map(d=>({ id:d.id, ...d.data() })));
    });
    const unsubS = onSnapshot(query(collection(db, "submissions"), orderBy("createdAt","desc")), (snap)=>{
      setSubmissions(snap.docs.map(d=>({ id:d.id, ...d.data() })));
    });
    return () => { unsubC(); unsubS(); };
  }, []);

  const filtered = useMemo(() => submissions.filter(s => active==="ALL" ? true : s.classCode === active), [submissions, active]);

  const conditionLabels = useMemo(() => {
    const set = new Set();
    submissions.forEach(s => (s.conditions||[]).forEach(c => set.add(c.label)));
    return Array.from(set);
  }, [submissions]);

  // --- Aggregations for richer stats ---
  const byCond = useMemo(() => {
    return conditionLabels.map(label => {
      const vals = filtered.flatMap(s => s.conditions||[])
        .filter(c=>c.label===label && typeof c.avg === "number")
        .map(c=>c.avg);
      const m = vals.length ? mean(vals) : 0;
      const s = se(vals);
      const { lo, hi } = vals.length ? ci95(vals) : { lo: m, hi: m };
      return { condition: label, average: m, n: vals.length, se: s, lo, hi };
    });
  }, [filtered, conditionLabels]);

  // For regression: average mass and distance for each condition label
  const massPoints = useMemo(() => {
    return conditionLabels.map(label => {
      const masses = filtered.flatMap(s=>s.conditions||[]).filter(c=>c.label===label).map(c=>c.mass).filter(Number.isFinite);
      const avgs   = filtered.flatMap(s=>s.conditions||[]).filter(c=>c.label===label && Number.isFinite(c.avg)).map(c=>c.avg);
      const mass = masses.length ? mean(masses) : null;
      const avg  = avgs.length ? mean(avgs)   : null;
      return (mass!=null && avg!=null) ? { x: mass, y: avg, label } : null;
    }).filter(Boolean);
  }, [filtered, conditionLabels]);

  const { slope, r2 } = useMemo(() => massPoints.length>=2 ? linreg(massPoints) : { slope:0, r2:0 }, [massPoints]);

  // Hypothesis tally and correctness vs observed slope
  const hypCounts = useMemo(() => {
    return filtered.reduce((a,s)=>{ const h = (s.hypothesis||"increase").toLowerCase(); a[h]=(a[h]||0)+1; return a; }, {});
  }, [filtered]);
  const correctPct = useMemo(() => {
    const total = (hypCounts.increase||0)+(hypCounts.decrease||0);
    if (!total) return null;
    const observedIncrease = slope > 0;
    const correct = observedIncrease ? (hypCounts.increase||0) : (hypCounts.decrease||0);
    return 100*correct/total;
  }, [hypCounts, slope]);

  // Precision leaderboard (lower SD across all trials per submission)
  const precisionRows = useMemo(() => {
    const rows = filtered.map(s => {
      const trials = (s.conditions||[]).flatMap(c => (c.trials||[])).filter(Number.isFinite);
      return { classCode: s.classCode, groupName: s.groupName, sd: sd(trials) };
    }).filter(r => r.sd!=null);
    rows.sort((a,b)=>a.sd-b.sd);
    return rows.slice(0,10);
  }, [filtered]);

  // Strip plot data: every trial point per condition
  const stripData = useMemo(() => {
    return conditionLabels.flatMap(label =>
      filtered.flatMap(s => s.conditions||[])
        .filter(c=>c.label===label)
        .flatMap(c => (c.trials||[]).filter(Number.isFinite).map(t => ({ condition: label, y: t })))
    );
  }, [filtered, conditionLabels]);

  // Cohen's d vs control
  const cohensTable = useMemo(() => {
    const ctrlVals = filtered.flatMap(s=>s.conditions||[]).filter(c=>/control/i.test(c.label)).map(c=>c.avg).filter(Number.isFinite);
    if (!ctrlVals.length) return [];
    return conditionLabels
      .filter(l => !/control/i.test(l))
      .map(label => {
        const vals = filtered.flatMap(s=>s.conditions||[]).filter(c=>c.label===label).map(c=>c.avg).filter(Number.isFinite);
        const d = cohensD(ctrlVals, vals);
        return { label, d };
      });
  }, [filtered, conditionLabels]);

  async function seedDefaultClasses() {
    const preset = [
      { code:"P2", name:"Period 2" },
      { code:"P3", name:"Period 3" },
      { code:"P4", name:"Period 4" },
      { code:"P6", name:"Period 6" },
      { code:"P7", name:"Period 7" },
      { code:"P8", name:"Period 8" },
    ];
    await Promise.all(preset.map(c => setDoc(doc(db, "classes", c.code), c)));
  }

  if (!authed) {
    return (
      <div className="card">
        <h3 style={{marginTop:0}}>Teacher Login</h3>
        <div className="grid">
          <div>
            <label>Teacher Key</label>
            <input type="password" value={key} onChange={e=>setKey(e.target.value)} />
          </div>
          <button onClick={()=>setAuthed(key===TEACHER_KEY)}>Enter</button>
          <div className="muted">Set VITE_TEACHER_KEY in your deploy env for a real key.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="grid" style={{gap:16}}>
      <div className="card">
        <div className="row" style={{justifyContent:"space-between"}}>
          <h3 style={{marginTop:0}}>Classes</h3>
          <div className="row" style={{gap:8}}>
            <button className="secondary" onClick={seedDefaultClasses}>Seed P2, P3, P4, P6, P7, P8</button>
          </div>
        </div>
        <div className="grid grid-3">
          <div>
            <label>Class Name</label>
            <input value={className} onChange={e=>setClassName(e.target.value)} placeholder="Period 2" />
          </div>
          <div>
            <label>Class Code</label>
            <input value={classCode} onChange={e=>setClassCode(e.target.value.toUpperCase())} placeholder="P2" />
          </div>
          <div>
            <label>&nbsp;</label>
            <div className="row">
              <button onClick={async ()=>{
                if (!className || !classCode) return;
                await setDoc(doc(db, "classes", classCode), { name: className, code: classCode });
                setClassName(""); setClassCode("");
              }}>Add / Update</button>
            </div>
          </div>
        </div>
        <div style={{marginTop:8, display:"flex", gap:8, flexWrap:"wrap"}}>
          <button className={active==="ALL" ? "" : "secondary"} onClick={()=>setActive("ALL")}>ALL ({submissions.length})</button>
          {classes.map(c => (
            <button key={c.code} className={active===c.code ? "" : "secondary"} onClick={()=>setActive(c.code)}>
              {c.name || c.code} ({submissions.filter(s=>s.classCode===c.code).length})
            </button>
          ))}
        </div>
      </div>

      {/* Stats header */}
      <div className="card">
        <div className="row" style={{justifyContent:"space-between", flexWrap:"wrap"}}>
          <div>
            <strong>Trend</strong>
            <div className="muted">Δdistance/Δmass = {slope.toFixed(3)} | R² = {r2.toFixed(2)}</div>
          </div>
          <div>
            <strong>Hypotheses</strong>
            <div className="muted">increase: {hypCounts.increase||0} | decrease: {hypCounts.decrease||0} {correctPct!=null && `| % correct ≈ ${correctPct.toFixed(0)}%`}</div>
          </div>
          <div>
            <strong>Active dataset</strong>
            <div className="muted">Groups: {filtered.length} | Conditions: {conditionLabels.length}</div>
          </div>
        </div>
      </div>

      <div className="grid grid-2">
        <div className="card">
          <strong>Average Distance by Condition {active==="ALL" ? "(All Classes)" : `— ${active}`}</strong>
          <div style={{height:300}}>
            <ResponsiveContainer>
              <BarChart data={byCond}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="condition" angle={-12} textAnchor="end" height={60} />
                <YAxis label={{ value: "Avg Distance (m)", angle: -90, position: "insideLeft" }} />
                <Tooltip />
                <Legend />
                <Bar dataKey="average" name="Avg Distance" />
              </BarChart>
            </ResponsiveContainer>
          </div>
          {/* CI table under the chart */}
          <div style={{overflowX:"auto", marginTop:8}}>
            <table>
              <thead>
                <tr><th>Condition</th><th className="right">n</th><th className="right">Mean</th><th className="right">SE</th><th className="right">95% CI</th></tr>
              </thead>
              <tbody>
                {byCond.map(r => (
                  <tr key={r.condition}>
                    <td>{r.condition}</td>
                    <td className="right">{r.n}</td>
                    <td className="right">{Number.isFinite(r.average)? r.average.toFixed(3):""}</td>
                    <td className="right">{Number.isFinite(r.se)? r.se.toFixed(3):""}</td>
                    <td className="right">{(r.lo!=null&&r.hi!=null)? `[${r.lo.toFixed(3)}, ${r.hi.toFixed(3)}]` : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="card">
          <strong>Trial Strip Plot (All Trials by Condition)</strong>
          <div style={{height:300}}>
            <ResponsiveContainer>
              <ScatterChart>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="condition" type="category" angle={-12} textAnchor="end" height={60} />
                <YAxis dataKey="y" label={{ value: "Distance (m)", angle: -90, position: "insideLeft" }} />
                <Tooltip />
                <Legend />
                <Scatter data={stripData} name="Trials" fill="#8884d8" />
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="grid grid-2">
        <div className="card">
          <strong>Compare Classes (Avg by Condition)</strong>
          <div style={{height:300}}>
            <ResponsiveContainer>
              <LineChart data={(() => {
                const classesSet = Array.from(new Set(submissions.map(s => s.classCode)));
                // pivot by condition
                return conditionLabels.map(label => {
                  const row = { condition: label };
                  classesSet.forEach(code => {
                    const vals = submissions
                      .filter(s => active==="ALL" ? s.classCode===code : s.classCode===active && code===active)
                      .flatMap(s => s.conditions||[])
                      .filter(c => c.label===label && typeof c.avg === "number")
                      .map(c => c.avg);
                    row[code] = vals.length ? mean(vals) : 0;
                  });
                  return row;
                });
              })()}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="condition" angle={-12} textAnchor="end" height={60} />
                <YAxis label={{ value: "Avg Distance (m)", angle: -90, position: "insideLeft" }} />
                <Tooltip />
                <Legend />
                {Array.from(new Set(submissions.map(s => s.classCode))).map(code => (
                  <Line key={code} type="monotone" dataKey={code} name={code} dot={false} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card">
          <strong>Precision Leaderboard (lowest SD wins)</strong>
          <div style={{overflowX:"auto"}}>
            <table>
              <thead>
                <tr><th>#</th><th>Class</th><th>Group</th><th className="right">SD (all trials)</th></tr>
              </thead>
              <tbody>
                {precisionRows.map((r, i) => (
                  <tr key={r.classCode + r.groupName}>
                    <td>{i+1}</td>
                    <td>{r.classCode}</td>
                    <td>{r.groupName}</td>
                    <td className="right">{r.sd.toFixed(3)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {cohensTable.length > 0 && (
        <div className="card">
          <strong>Effect Size vs Control (Cohen's d)</strong>
          <div className="muted">~0.2 small • ~0.5 medium • ~0.8 large (sign shows direction vs control)</div>
          <div style={{overflowX:"auto", marginTop:8}}>
            <table>
              <thead>
                <tr><th>Group</th><th className="right">d</th></tr>
              </thead>
              <tbody>
                {cohensTable.map(row => (
                  <tr key={row.label}>
                    <td>{row.label}</td>
                    <td className="right">{row.d==null? "" : row.d.toFixed(3)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="card">
        <strong>Submissions ({filtered.length})</strong>
        <div style={{overflowX:"auto"}}>
          <table>
            <thead>
              <tr>
                <th>When</th><th>Class</th><th>Group</th><th>Members</th>
                <th>Hypothesis</th>
                <th>Condition</th><th className="right">Mass (g)</th>
                <th className="right">T1</th><th className="right">T2</th><th className="right">T3</th>
                <th className="right">Avg</th><th className="right">SD</th>
              </tr>
            </thead>
            <tbody>
              {filtered.flatMap(s => (s.conditions||[]).map(c => (
                <tr key={s.id + c.label}>
                  <td>{s.createdAt?.toDate?.().toLocaleString?.() ?? ""}</td>
                  <td>{s.classCode}</td>
                  <td>{s.groupName}</td>
                  <td>{(s.members||[]).join(", ")}</td>
                  <td>{s.hypothesis || ""}</td>
                  <td>{c.label}</td>
                  <td className="right">{c.mass ?? ""}</td>
                  <td className="right">{c.trials?.[0] ?? ""}</td>
                  <td className="right">{c.trials?.[1] ?? ""}</td>
                  <td className="right">{c.trials?.[2] ?? ""}</td>
                  <td className="right">{typeof c.avg === "number" ? c.avg.toFixed(3) : ""}</td>
                  <td className="right">{typeof c.sd === "number" ? c.sd.toFixed(3) : ""}</td>
                </tr>
              )))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// -------------------- App Shell + basic styles (works with Vite index.html) --------------------
export default function App() {
  const [tab, setTab] = useState("student");
  return (
    <div className="grid" style={{gap:16, marginTop:16}}>
      <style>{`
        .card { background:#fff; border:1px solid #e5e7eb; border-radius:12px; padding:16px; }
        .grid { display:grid; gap:12px; }
        .grid-3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
        .grid-2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        label { font-size:12px; color:#374151; display:block; margin-bottom:4px; }
        input, select, button { font-size:14px; padding:10px 12px; border:1px solid #d1d5db; border-radius:10px; width:100%; box-sizing:border-box; }
        button { cursor:pointer; background:#111827; color:#fff; border:none; }
        button.secondary { background:#fff; color:#111827; border:1px solid #d1d5db; }
        table { border-collapse: collapse; width: 100%; font-size: 14px; }
        th, td { padding: 8px 10px; border-bottom: 1px solid #e5e7eb; text-align: left; }
        th { background: #f3f4f6; }
        .tabs { display:flex; gap:8px; margin-bottom:12px; }
        .tabs button { padding:8px 12px; border-radius:999px; border:1px solid #d1d5db; background:#fff; color:#111; }
        .tabs button.active { background:#111827; color:#fff; }
        .muted { color:#6b7280; font-size:12px; }
        .row { display:flex; gap:8px; align-items:center; }
        .right { text-align:right; }
      `}</style>

      <div className="tabs">
        <button className={tab==="student" ? "active" : ""} onClick={()=>setTab("student")}>Student</button>
        <button className={tab==="teacher" ? "active" : ""} onClick={()=>setTab("teacher")}>Teacher</button>
      </div>
      {tab==="student" ? <StudentForm/> : <TeacherDashboard/>}
    </div>
  );
}
