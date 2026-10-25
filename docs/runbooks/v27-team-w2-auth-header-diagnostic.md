# Historical W2 header diagnosis — retired

The two bounded staging investigations are complete. They are historical evidence,
not instructions to repeat a request. The callable Node diagnostic factories were
removed from the final PR source. Their exact revisions remain in Git and sealed
acceptance artifacts.

At source head `b47d7b766f346357e32448d28ced3cfb6b767fcc`, the single second POST
returned HTTP200 with Node `sb_secret`, downstream Authorization `bearer_jwt`,
apikey absent, role service_role and custom probe matched. The conservative result
was `V27_TEAM_W2_AUTH_HEADER_DIAGNOSTIC_HOLD`. No specific gateway hop was proved,
and one custom-probe round-trip did not authorize a W2 security mechanism.

The diagnostic migrations remain immutable in migration history. The final
additive evidence-channel migration removes both public diagnostic RPCs, so a
fresh production install of the whole sequence ends without those endpoints.
Do not repeat header guesses or use Supabase credentials as shared MAC material.

The current design and staging acceptance sequence are documented in
[v27-team-w2-derived-evidence-channel.md](v27-team-w2-derived-evidence-channel.md).
Production rollout and W2 execution remain separate owner authorizations.
