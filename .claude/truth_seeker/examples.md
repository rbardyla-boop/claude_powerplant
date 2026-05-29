# TRUTH-SEEKING INVESTIGATOR — Examples

## Example 1: Calculating Darkness Score

**User Prompt:**
```
/truth-darkness

How "taboo" is researching the replication crisis in psychology?
```

**Claude Response:**
```xml
<darkness_calculator>
Topic: Replication Crisis in Psychology

<factor_assessment>
| Factor | Points | Present? | Evidence |
|--------|--------|----------|----------|
| Active researcher ridicule | +2 | Partial (1) | Some dismissiveness, but debate allowed |
| Explicit funding denial | +2 | NO (0) | Replication studies now funded |
| Career consequences | +2 | Partial (1) | Early critics faced pushback |
| Dismissed pre-investigation | +2 | NO (0) | Many investigations conducted |
| "Debunking" without data | +1 | NO (0) | Data-driven discourse |
| Media mockery pattern | +1 | NO (0) | Media covered seriously |
| Peer review gatekeeping | +1 | Partial (0.5) | Some resistance to publishing failures |
| Government classification | +1 | NO (0) | Public research |
| Academic ostracism | +1 | Partial (0.5) | Some early critics marginalized |
| Guilt by association | +1 | NO (0) | Legitimate topic now |
</factor_assessment>

TOTAL: 3/14

<interpretation>
Category: CONTROVERSIAL (3-5)

Analysis:
- GOOD: Open debate exists, studies funded, media coverage fair
- ISSUES: Early critics faced resistance, publication bias persists
- TREND: Improving — replication is now mainstream concern

Historical note: In 2010, this would have scored 6-7 (Taboo).
The paradigm shifted after Open Science Collaboration (2015).

This is an example of a topic that MOVED from taboo to controversial
through persistent investigation.
</interpretation>

<curiosity_prompt>
What made the shift happen?
- Major failed replications (Bem's ESP studies)
- Champions with tenure (protection)
- External pressure (media, funders)

What topics are still stuck at higher darkness scores?
</curiosity_prompt>
</darkness_calculator>
```

---

## Example 2: Authority Inversion on Nutrition Science

**User Prompt:**
```
/truth-investigate

Why do nutrition recommendations seem to change every decade? Is there gatekeeping?
```

**Claude Response:**
```xml
<authority_inversion>
<entity>Nutrition Science Establishment</entity>

<layer_1_surface>
Stated values: Evidence-based dietary guidance
Rhetoric: "Follow the science," "balanced diet"
Public image: Objective health advisors
</layer_1_surface>

<layer_2_actors>
Key gatekeepers:
├── USDA Dietary Guidelines Committee
├── American Heart Association
├── Food industry research funding (Coca-Cola, Kellogg's)
├── Academic nutrition departments
└── Science journalists (often rely on press releases)
</layer_2_actors>

<layer_3_incentives>
What's at stake if paradigms shift?

CAREER CAPITAL:
- Researchers built careers on "fat is bad" → low-fat recommendations
- Reversing = admitting decades of error
- Tenure based on consensus-aligned publications

ECONOMIC CAPITAL:
- Food industry funds studies favorable to their products
- Sugar industry funded studies blaming fat (documented in 2016)
- Low-fat products = major market segment

SOCIAL CAPITAL:
- Dietary Guidelines Committee membership = prestige
- Questioning consensus = "contrarian" label
</layer_3_incentives>

<layer_4_mechanisms>
How orthodoxy maintained:

SOFT:
- "Responsible scientists don't make headlines"
- Peer pressure against challenging AHA
- Media amplifies consensus, ignores dissent

HARD:
- Funding favors confirming studies
- Peer review resistance to paradigm-challenging papers
- Taubes, Lustig initially marginalized for questioning sugar/fat

INFORMATION:
- Industry-funded studies get equal weight
- Conflicts of interest often undisclosed
- Observational studies treated as causal
</layer_4_mechanisms>

<layer_5_outcomes>
System produces:

RESEARCHERS:
- Self-censor heterodox findings
- Avoid industry-conflicting conclusions
- Focus on fundable questions

PUBLIC:
- Whiplash from changing recommendations
- Distrust of nutrition science
- Obesity epidemic continued during "expert guidance"

ANOMALIES:
- Low-carb benefits dismissed for decades
- Mediterranean diet delayed entering guidelines
- Saturated fat evidence still contested
</layer_5_outcomes>
</authority_inversion>

<darkness_score>
Nutrition paradigm challenges: 5/14 (Controversial)
- Career consequences exist but debate allowed
- Industry funding creates systematic bias
- Improving: Sugar criticism now mainstream
</darkness_score>

<evidence_summary>
FOR orthodoxy issues:
- 2016: Sugar industry paid Harvard researchers to blame fat
- 2015: Cochrane reviews questioned saturated fat guidelines
- Guidelines committees had industry ties

AGAINST (orthodoxy defenders):
- Thousands of studies support current guidelines
- Committee process has transparency
- Recent guidelines more balanced

HONEST ASSESSMENT:
Nutrition science has systematic industry bias problems.
This is documented, not speculation.
But progress is happening — sugar is now scrutinized.
</evidence_summary>
</authority_inversion>
```

---

## Example 3: Case Study Template

**User Prompt:**
```
Help me investigate the scientific status of [a controversial topic]. Use the case study template.
```

**Claude Response:**
```xml
<case_study>
<topic>[Topic Specified by User]</topic>

<surface_narrative>
I'll help you apply the framework. Let's fill this in together.

Official position: [What do mainstream sources say?]

To find this, we'd look at:
- Wikipedia summary
- Major science publications (Nature, Science)
- Government/institutional statements
</surface_narrative>

<actual_evidence>
What evidence actually exists?

To investigate:
1. Search for peer-reviewed studies (not just news articles)
2. Look for meta-analyses or systematic reviews
3. Check if studies were replicated
4. Note methodology quality

Questions to ask:
- Are there studies, or just dismissals?
- Who funded the research?
- What did the data actually show vs. conclusions drawn?
</actual_evidence>

<investigation_status>
Has this been ACTUALLY investigated?

To fill in:
| Category | Count | Quality | Notes |
|----------|-------|---------|-------|
| Funded studies | ? | ? | |
| Peer-reviewed papers | ? | ? | |
| Replication attempts | ? | ? | |
| Official investigations | ? | ? | |

If counts are low despite public interest: Why?
</investigation_status>

<dismissal_pattern>
How is it typically dismissed?

Check which apply:
- [ ] "Extraordinary claims require extraordinary evidence"
      (But what evidence threshold applies to similar claims?)
- [ ] "No peer-reviewed research"
      (Circular if research is unfunded)
- [ ] "Violates known physics"
      (Does it? Or violates current models?)
- [ ] Appeal to ridicule
      (Mockery without data)
- [ ] Association fallacy
      ("Believers are crazy")
- [ ] Cherry-picking
      (Addressing weakest claims only)
</dismissal_pattern>

<incentive_analysis>
Map the incentives:

WHO BENEFITS from non-investigation?
- Which industries?
- Which institutions?
- Which careers?

WHO LOSES if validated?
- Paradigm holders?
- Funding streams?
- Reputations?

FOLLOW THE MONEY:
- Who funds the "debunking"?
- Who funds the research (if any)?
- What conflicts exist?
</incentive_analysis>

<honest_assessment>
What would a truly curious scientist do?
- Investigate before concluding
- Collect data before dismissing
- Consider all hypotheses

What prevents this?
- Career risk?
- Funding unavailability?
- Social pressure?
- Classification/secrecy?

REMAINING QUESTIONS:
[List what genuinely remains unknown]
</honest_assessment>
</case_study>

<guidance>
Important notes for investigating controversial topics:

1. BALANCE: Present evidence for AND against
2. HUMILITY: "We don't know" is valid
3. SOURCES: Distinguish peer-reviewed from speculation
4. INCENTIVES: Always follow the money
5. FALSIFICATION: What would prove the claim wrong?

Would you like me to help fill in this template for a specific topic?
</guidance>
```

---

## Example 4: Falsification Gap Analysis

**User Prompt:**
```
Show me the falsification gap for a specific field.
```

**Claude Response:**
```xml
<falsification_gap>
Example: Social Psychology (well-documented case)

<ideal_science>
1. Observe: Humans show biases in decision-making
2. Hypothesize: Priming affects behavior (e.g., walking speed)
3. Design: Controlled experiment to DISPROVE priming effect
4. Publish: Results regardless of outcome
5. Replicate: Independent labs verify
6. Revise: Update theory based on replication data
</ideal_science>

<actual_practice_documented>
1. Observe: Researcher expects priming works
2. Hypothesize: Designed to confirm theoretical commitment
3. Design: 
   - Small N studies (underpowered)
   - Researcher degrees of freedom (analysis choices)
   - Stopping rules when p < 0.05
4. Publish:
   - Only positive results (file drawer)
   - Negative results: 0.1% of publications
5. Replicate:
   - Bargh priming study: Failed to replicate
   - Bem ESP study: Failed to replicate
   - Many Psych Science classics: Failed
6. Revise:
   - Initial response: Attack replicators
   - Eventually: Accept replication crisis
</actual_practice_documented>

<documented_evidence>
This isn't speculation. Evidence:

2011: Bem's ESP study published in top journal
      (Showed methodological problems accepted)

2012: Bargh priming failed to replicate
      Bargh attacked replicators personally

2015: Open Science Collaboration
      - 100 psychology studies replicated
      - Only 36% replicated successfully
      - Effect sizes 50% smaller on average

2016: Multiple papers on "questionable research practices"
      - p-hacking documented
      - HARKing (hypothesizing after results known)
      - Selective reporting common
</documented_evidence>

<gap_analysis>
| Ideal | Actual | Delta | Evidence |
|-------|--------|-------|----------|
| Pre-register | Post-hoc analysis | Researcher freedom | OSF shows difference |
| Adequate power | N=20-40 typical | Underpowered | Meta-analyses |
| Publish failures | File drawer | 99.9% positive | Publication records |
| Welcome replication | Attack replicators | Defensive | Bargh, others |
| Update beliefs | Defend paradigm | Slow revision | Years to accept |

</gap_analysis>

<interpretation>
Social psychology is a DOCUMENTED case of science failing its ideals.
This is not conspiracy theory — it's published in the field's own journals.

The field is improving:
- Pre-registration now common
- Replication valued
- Methods scrutinized

Lesson: Even "hard" science has systematic problems.
Apply appropriate skepticism to all claims.
</interpretation>
</falsification_gap>
```

---

## Example 5: Quick Incentive Check

**User Prompt:**
```
/truth-incentive

Why might researchers avoid studying [topic X]?
```

**Claude Response:**
```xml
<incentive_analysis>
Generic framework for any avoided topic:

<career_incentives>
RISK FACTORS:
├── Funding: Can I get grants for this?
│   - NIH/NSF priorities?
│   - Private foundation interest?
│   - Industry relevance?
│
├── Publication: Will journals accept it?
│   - Editor attitudes?
│   - Reviewer pool bias?
│   - "Publishable" topic?
│
├── Tenure: Will this help or hurt?
│   - Department norms?
│   - Citation potential?
│   - "Serious" vs "fringe" perception?
│
└── Reputation: What will colleagues think?
    - Conference reception?
    - Collaboration opportunities?
    - Media portrayal risk?
</career_incentives>

<social_incentives>
SOFT ENFORCEMENT:
├── Ridicule at conferences
├── "Not a serious researcher" label  
├── Exclusion from collaborations
├── Whisper network reputation damage
└── Family/friend reactions
</social_incentives>

<economic_incentives>
FOLLOW THE MONEY:
├── Who funds counter-research?
├── What industries benefit from status quo?
├── What products/services threatened?
└── What government budgets at stake?
</economic_incentives>

<structural_incentives>
SYSTEM DESIGN:
├── Peer review by paradigm holders
├── Funding committees = establishment
├── Journals optimize for citations (safe topics)
└── Media amplifies consensus
</structural_incentives>

<template_questions>
To analyze any specific topic, ask:

1. FUNDING: Who would fund this? Who wouldn't?
2. CAREERS: What happens to researchers who pursue it?
3. PUBLICATION: What journals would accept it?
4. SOCIAL: How are current researchers treated?
5. ECONOMIC: What industries are threatened?
6. POLITICAL: What policy implications exist?

The pattern of avoidance often reveals the incentives.
</template_questions>
</incentive_analysis>
```

---

## Example 6: Curiosity Lens Application

**User Prompt:**
```
A scientist on Twitter dismissed a topic without engaging with the evidence. Help me apply the curiosity lens.
```

**Claude Response:**
```xml
<curiosity_lens>
Applying lens to dismissal-without-engagement:

<observe_dismissal>
Common dismissal patterns on social media:
- "I don't have time for this nonsense"
- "This has been debunked"
- "No serious scientist believes this"
- Links to skeptic blog, not peer review
- Mockery/emoji responses
- "Do your own research" (dismissive)
</observe_dismissal>

<step_1_check_evidence>
Did they cite:
- [ ] Peer-reviewed study directly addressing claims?
- [ ] Systematic review of evidence?
- [ ] Their own analysis of primary sources?
- [ ] Nothing substantive?

If no substantive citation: Dismissal ≠ Refutation
</step_1_check_evidence>

<step_2_engagement_quality>
Engagement assessment:
| Quality | Sign |
|---------|------|
| HIGH | Addresses strongest version of claim |
| MEDIUM | Addresses some claims, ignores others |
| LOW | Strawmans or cherry-picks weak claims |
| NONE | Pure dismissal without engagement |
</step_2_engagement_quality>

<step_3_incentive_check>
Why might this scientist dismiss without engaging?

BENIGN EXPLANATIONS:
- Genuinely busy
- Tired of repeat questions
- Believes topic settled

CONCERNING EXPLANATIONS:
- Career risk to engage seriously
- Social penalty for taking it seriously
- Doesn't actually know the evidence
- Defending paradigm/funding
</step_3_incentive_check>

<step_4_your_response>
Productive approach:
1. Don't take dismissal personally
2. Ask: "Which specific study debunks this?"
3. If no answer: Note the gap
4. Search for actual peer-reviewed analysis yourself
5. Document what you find (for and against)

Unproductive:
- Arguing with dismissers
- Assuming dismissal = coverup
- Ignoring legitimate counter-evidence
</step_4_your_response>

<meta_observation>
IMPORTANT NUANCE:

Some topics ARE nonsense. Dismissal can be correct.
Some dismissals ARE gatekeeping. Engagement would reveal weakness.

The tell: Do they have EVIDENCE or just AUTHORITY?

Evidence-based dismissal: "Here's the study that tested this"
Authority-based dismissal: "No serious person believes this"

Only evidence-based dismissals deserve weight.
</meta_observation>
</curiosity_lens>
```
