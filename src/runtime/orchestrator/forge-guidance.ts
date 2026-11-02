/**
 * The forge and report guidance every department's system prompt carries,
 * whatever the scenario: the universal `forge_tool` instructions, a worked
 * example the department adapts to its own domain, and the report format.
 *
 * @module paracosm/runtime/orchestrator/forge-guidance
 */
export function buildForgeGuidance(dept: string): string {
  return `

EMERGENT TOOLING — forge + reuse economy:

You have TWO meta-tools for computational analysis:

1. call_forged_tool(name, args): invoke a tool ALREADY in the ALREADY-FORGED TOOLS context block. No judge review. Costs nothing. Returns fresh output for new inputs. This is the FIRST thing to reach for when the toolbox has a tool whose scope covers your current question.

2. forge_tool(...): build a NEW tool from scratch. Judge-reviewed for safety and correctness before it executes. Adds to the toolbox. Use only when no existing tool covers the analysis, or when a fresh angle would add real insight.

Before every analysis, READ the ALREADY-FORGED TOOLS block carefully. Ask:
  (a) Does an existing tool compute what I need? → call_forged_tool it.
  (b) Does an existing tool almost compute it with different inputs? → call_forged_tool it, accept approximate fit.
  (c) Does NO existing tool apply, or would a novel composition produce genuine new insight? → forge_tool.

Forge when quantitative reasoning is needed and the toolbox has no applicable tool for it. Reuse when the toolbox already covers the question. Your personality profile above shapes how aggressive you are on either side of that line.

The implementation of forged tools runs in an in-process node:vm context (10s timeout, heap usage observed but not preemptively capped). Forged code here gets no capabilities: keep "allowlist": [] (fetch, fs and crypto are refused). An LLM judge reviews your tool for safety AND CORRECTNESS before it executes.

HARD RULES — if you violate any of these, a local validator rejects the forge BEFORE the judge sees it and you waste the attempt:

1. inputSchema.properties MUST have at least two named fields, each with a JSON Schema "type". {"type":"object","additionalProperties":true} with NO properties is an automatic reject. Always list the fields your code reads.
2. outputSchema.properties MUST have at least one named field with a type. Empty output schemas are rejected.
3. additionalProperties on both schemas SHOULD be false so the declared shape is authoritative.
4. testCases MUST have at least 2 entries. Each testCase.input must be a non-empty object whose keys match your declared inputSchema fields. Tests with input:{} are rejected.
5. Every testCase.expectedOutput must name at least one field from your outputSchema — empty expectedOutput defeats the judge's correctness check.

⚠️ #1 FORGE REJECTION REASON IN PRODUCTION — READ THIS CAREFULLY:
The judge rejects most failed forges for "violates declared output schema by returning additional properties not allowed by additionalProperties:false." This happens when your implementation's return statement includes extra "helpful" fields (intermediate calculations, debug info, recommendations) that aren't declared in outputSchema.properties.

  BAD (auto-reject):
    outputSchema.properties = { score, tier }, additionalProperties: false
    return { score: 0.7, tier: "high", recommended_action: "evacuate" }  ← extra field ✗

  GOOD:
    outputSchema.properties = { score, tier }, additionalProperties: false
    return { score: 0.7, tier: "high" }  ← only declared keys ✓

  ALSO GOOD (when you want the extra field):
    outputSchema.properties = { score, tier, recommended_action }, additionalProperties: false
    return { score: 0.7, tier: "high", recommended_action: "evacuate" }  ← declare it, then return it

Your implementation's return statement MUST contain EXACTLY the keys listed in outputSchema.properties — no more, no less. If you want to return intermediate or debug fields, DECLARE THEM in outputSchema.properties first. This is the single biggest cause of wasted forge attempts.

Match the full worked example below exactly; do not emit placeholder/schema-skeleton forms.

ROBUSTNESS RULES (the judge enforces these — failed forges hurt the simulation state):
1. Validate every numeric input. If a field is missing/null/undefined or NaN, default it to a safe value or return a conservative result. Never let the function throw or return NaN/Infinity.
2. Wrap the body in a try/catch and return a defined object on error: { "score": 0, "warnings": ["missing input X"] }.
3. Use Number.isFinite() before using any input in arithmetic. Avoid division — multiply by reciprocals or guard with (denominator || 1).
4. ARRAYS: never call .includes(), .map(), .filter(), .some(), .find(), .length, etc. on an input without first checking Array.isArray(x). Default missing arrays to []: const arr = Array.isArray(input.items) ? input.items : []. A single "Cannot read properties of undefined (reading 'includes')" TypeError fails the whole tool and costs the simulation morale + power.
5. STRINGS: same rule — guard with typeof x === 'string' before .includes()/.split()/.toLowerCase(). Default to '' when missing.
6. Provide AT LEAST 3 testCases:
   - one happy path with realistic numbers
   - one with a missing/zero input (must NOT throw)
   - one with a boundary value (population=0, capacity=1, etc.)
7. Bound your output to a defined range (e.g., score 0..100, multiplier 0.1..10) so downstream code stays predictable.

GOOD FORGE EXAMPLE (follow this shape, adapt the domain). Every declared property is in "required". No optional output fields — the judge treats optional fields as schema-mismatch bait, so KEEP EVERY FIELD REQUIRED and always return every one from execute().
{
  "name": "radiation_dose_risk_score",
  "description": "Scores cumulative radiation exposure risk on 0..100.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "cumulative_dose_msv": { "type": "number", "description": "mSv lifetime" },
      "age_years": { "type": "number" },
      "shielding_factor": { "type": "number", "description": "0..1 reduction" }
    },
    "required": ["cumulative_dose_msv", "age_years", "shielding_factor"],
    "additionalProperties": false
  },
  "outputSchema": {
    "type": "object",
    "properties": {
      "risk_score": { "type": "number", "description": "0..100, higher is worse" },
      "tier": { "type": "string", "enum": ["low", "medium", "high", "critical"] }
    },
    "required": ["risk_score", "tier"],
    "additionalProperties": false
  },
  "implementation": {
    "mode": "sandbox",
    "code": "function execute(input){try{const d=Number.isFinite(+input.cumulative_dose_msv)?+input.cumulative_dose_msv:0;const a=Number.isFinite(+input.age_years)?+input.age_years:30;const s=Number.isFinite(+input.shielding_factor)?Math.max(0,Math.min(1,+input.shielding_factor)):0;const eff=d*(1-s);let score=Math.max(0,Math.min(100,eff/30*(1+Math.max(0,(60-a))/100)));const tier=score>=80?'critical':score>=50?'high':score>=20?'medium':'low';return{risk_score:Math.round(score),tier};}catch(e){return{risk_score:0,tier:'low'};}}",
    "allowlist": []
  },
  "testCases": [
    { "input": { "cumulative_dose_msv": 1200, "age_years": 42, "shielding_factor": 0.3 }, "expectedOutput": { "tier": "high" } },
    { "input": { "cumulative_dose_msv": 0, "age_years": 30, "shielding_factor": 0 }, "expectedOutput": { "risk_score": 0, "tier": "low" } },
    { "input": { "cumulative_dose_msv": 4000, "age_years": 65, "shielding_factor": 0 }, "expectedOutput": { "tier": "critical" } }
  ]
}
Every field declared in properties AND required AND returned by execute() — and NOTHING ELSE returned by execute(). additionalProperties:false on both schemas means the return-statement key set equals the outputSchema.properties key set exactly. Three real test cases each with real inputs matching declared fields and a field-level assertion in expectedOutput. Match this density exactly or the judge will reject.

IF YOUR FORGE IS REJECTED: the tool result will tell you the exact shape failure ("inputSchema has no declared properties", "outputSchema has no declared properties", "testCases use empty input", etc.). Immediately call forge_tool AGAIN with those specific fixes. Do not skip. Do not move to a different tool. Fix the named fields and resubmit — you get two retries before the department moves on.

REPORT FORMAT:
Respond with valid JSON ONLY (no markdown, no prose outside the JSON):
{
  "department": "${dept}",
  "summary": "...",
  "citations": [{"text": "...", "url": "...", "context": "..."}],
  "risks": [{"severity": "low|medium|high|critical", "description": "..."}],
  "opportunities": [{"impact": "low|medium|high", "description": "..."}],
  "recommendedActions": ["..."],
  "forgedToolsUsed": [{"name": "tool_name", "mode": "sandbox", "description": "what it does", "output": {...}, "confidence": 0.9}],
  "recommendedEffects": [{"id": "effect_1", "type": "resource_shift|capacity_expansion|risk_mitigation|social_investment|research_bet", "description": "...", "systemDelta": {"morale": 0.05}}],
  "confidence": 0.85,
  "openQuestions": [],
  "featuredAgentUpdates": [],
  "proposedPatches": {}
}`;
}
