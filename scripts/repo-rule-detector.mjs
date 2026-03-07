#!/usr/bin/env node
/**
 * repo-rule-detector.mjs
 *
 * Detect GitHub repository rules that commonly affect dev flow:
 * - require PRs for main
 * - required status checks
 * - required reviews
 * - admin enforcement
 * - allowed merge methods (merge commit / squash / rebase)
 *
 * Usage:
 *   node scripts/repo-rule-detector.mjs owner/repo
 *   node scripts/repo-rule-detector.mjs owner/repo --branch main
 *
 * Example:
 *   node scripts/repo-rule-detector.mjs microsoft/vscode
 *
 * Example output (excerpt):
 *   {
 *     "rulesets": [
 *       {
 *         "rules": {
 *           "required_linear_history": false,
 *           "non_fast_forward": true,
 *           "pull_request": {
 *             "required_review_thread_resolution": false,
 *             "allowed_merge_methods": ["merge","squash","rebase"],
 *             "required_approving_review_count": 1
 *           }
 *         }
 *       }
 *     ]
 *   }
 *
 * Output notes:
 *   - rulesets[].rules.pull_request prints fields like:
 *     required_review_thread_resolution, allowed_merge_methods,
 *     required_approving_review_count
 *   - rulesets[].rules.required_linear_history / non_fast_forward are booleans
 *
 * Requires:
 *   - gh auth
 */

import { execFileSync } from 'node:child_process';

function sh(args) {
  // Keep stdout machine-readable: never let gh chatter leak into our output.
  return execFileSync('gh', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim();
}

function pick(obj, keys) {
  if (!obj) return null;
  const out = {};
  for (const k of keys) out[k] = obj?.[k] ?? null;
  return out;
}

function parseArgs(argv) {
  const out = { repo: null, branch: 'main' };
  const rest = [];
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--branch') { out.branch = argv[++i]; continue; }
    rest.push(a);
  }
  if (rest.length < 1) throw new Error('Missing repo argument: owner/repo');
  out.repo = rest[0];
  return out;
}

function main() {
  const { repo, branch } = parseArgs(process.argv);

  const repoInfo = JSON.parse(sh(['api', `repos/${repo}`]));

  // Branch protection (classic)
  let bp = null;
  try {
    bp = JSON.parse(sh(['api', `repos/${repo}/branches/${branch}/protection` ]));
  } catch {
    bp = null;
  }

  // Repo rulesets (new)
  let rulesets = [];
  try {
    rulesets = JSON.parse(sh(['api', `repos/${repo}/rulesets`, '--paginate']));
  } catch {
    rulesets = [];
  }

  const PULL_REQUEST_PARAM_KEYS = [
    'required_review_thread_resolution',
    'allowed_merge_methods',
    'required_approving_review_count',
    // extras (kept for convenience / debugging)
    'require_code_owner_review',
    'dismiss_stale_reviews_on_push',
    'require_last_push_approval'
  ];

  function fetchRulesetDetails(rulesetId) {
    try {
      return JSON.parse(sh(['api', `repos/${repo}/rulesets/${rulesetId}`]));
    } catch {
      return null;
    }
  }

  function hasRuleType(rules, type) {
    return Array.isArray(rules) && rules.some(r => r?.type === type);
  }

  function summarizeRulesetRules(rules) {
    const prRule = Array.isArray(rules) ? rules.find(r => r?.type === 'pull_request') : null;
    const prParams = prRule?.parameters ? pick(prRule.parameters, PULL_REQUEST_PARAM_KEYS) : null;

    return {
      pull_request: prParams,
      required_linear_history: hasRuleType(rules, 'required_linear_history'),
      non_fast_forward: hasRuleType(rules, 'non_fast_forward'),
      deletion: hasRuleType(rules, 'deletion')
    };
  }

  const relevantRulesets = [];
  for (const rs of rulesets) {
    if (!rs?.enforcement || rs.enforcement === 'disabled') continue;

    const details = fetchRulesetDetails(rs.id);
    const refCond = details?.conditions?.ref_name ?? null;
    const targets = refCond?.include ?? [];

    const isRelevant =
      targets.length === 0 ||
      targets.includes('~ALL') ||
      targets.includes('~DEFAULT_BRANCH') ||
      targets.includes(branch) ||
      targets.includes(`refs/heads/${branch}`);

    if (!isRelevant) continue;

    relevantRulesets.push({
      id: rs.id,
      name: rs.name,
      enforcement: rs.enforcement,
      target: refCond,
      rules: summarizeRulesetRules(details?.rules ?? [])
    });
  }

  const allowedMergeMethods = {
    mergeCommit: !!repoInfo.allow_merge_commit,
    squash: !!repoInfo.allow_squash_merge,
    rebase: !!repoInfo.allow_rebase_merge
  };

  const rulesetsRulePresence = {
    required_linear_history: relevantRulesets.some(rs => !!rs?.rules?.required_linear_history),
    non_fast_forward: relevantRulesets.some(rs => !!rs?.rules?.non_fast_forward),
    deletion: relevantRulesets.some(rs => !!rs?.rules?.deletion)
  };

  const out = {
    repo: repoInfo.full_name,
    url: repoInfo.html_url,
    defaultBranch: repoInfo.default_branch,
    branch,
    allowedMergeMethods,
    rulesetsRulePresence,
    branchProtection: bp ? {
      enabled: true,
      requiredStatusChecks: bp.required_status_checks ? {
        strict: bp.required_status_checks.strict,
        contexts: bp.required_status_checks.contexts,
        checks: bp.required_status_checks.checks
      } : null,
      requiredPullRequestReviews: bp.required_pull_request_reviews ? {
        requiredApprovingReviewCount: bp.required_pull_request_reviews.required_approving_review_count,
        requireCodeOwnerReviews: bp.required_pull_request_reviews.require_code_owner_reviews,
        dismissStaleReviews: bp.required_pull_request_reviews.dismiss_stale_reviews
      } : null,
      enforceAdmins: bp.enforce_admins?.enabled ?? null,
      restrictions: bp.restrictions ?? null
    } : { enabled: false },
    rulesets: relevantRulesets
  };

  console.log(JSON.stringify(out, null, 2));
}

main();
