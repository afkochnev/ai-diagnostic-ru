# Team UAT: consistent dispersion units

The summary uses a 0–100 scale and individual questions use 0–4. Showing their raw population standard deviations under the same unqualified “Разброс” heading made equivalent dispersion appear different: the accepted UAT case showed 20.4 in the summary and 0.8 in the appendix.

All web and PDF dispersion values now display population SD as a percentage of the full scale range: `SD / scaleRange * 100`. The example is 20.4% on both surfaces. Means remain in their existing scales. Classification still uses the unrounded value and the existing v1 thresholds; scoring, methodology, stored statistics and AI content are unchanged.

PDF template `team-report-v3-dispersion-percent-v1` creates a separate immutable artifact. Existing `team-report-v3` PDFs remain intact. Preparing the updated PDF uses the completed report and saved aggregate; no AI regeneration or aggregate recalculation is needed.

This is a temporary staging UAT branch based on the accepted runtime. Do not merge it into main or PR #16. Staging rollout requires the reviewed exact SHA; no migrations, environment, secrets, gates, production, W2 or billing changes are part of this display fix.
