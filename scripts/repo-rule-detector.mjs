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
 * Requires:
 *   - gh auth
 */

import { execFileSync } from 'node:child_process';

function sh(args) {
  return execFileSync('gh', args, { encoding: 'utf8' }).trim();
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

  const relevantRulesets = rulesets
    .filter(rs => rs?.enforcement && rs.enforcement !== 'disabled')
    .filter(rs => {
      const targets = rs?.conditions?.ref_name?.include ?? [];
      return targets.length === 0 || targets.includes('~DEFAULT_BRANCH') || targets.includes(branch) || targets.includes(`refs/heads/${branch}`);
    })
    .map(rs => ({
      id: rs.id,
      name: rs.name,
      enforcement: rs.enforcement,
      target: rs?.conditions?.ref_name ?? null
    }));

  const allowedMergeMethods = {
    mergeCommit: !!repoInfo.allow_merge_commit,
    squash: !!repoInfo.allow_squash_merge,
    rebase: !!repoInfo.allow_rebase_merge
  };

  const out = {
    repo: repoInfo.full_name,
    url: repoInfo.html_url,
    defaultBranch: repoInfo.default_branch,
    branch,
    allowedMergeMethods,
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
