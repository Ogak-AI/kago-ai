// ============================================================
// Kago AI – Main Entry Point
// Registers all Devvit plugins: triggers, menus, custom post,
// scheduler jobs, and app install/upgrade lifecycle events.
// ============================================================

import { Devvit } from '@devvit/public-api';

// ── Services imported for side-effects (scheduler job registration)
import './scheduler/jobs.js';

// ── Feature modules
import { handlePostSubmit } from './triggers/post.trigger.js';
import { handleCommentSubmit } from './triggers/comment.trigger.js';
import { handleModAction } from './triggers/modaction.trigger.js';
import {
  kagoApprovePost,
  kagoBanUserPost,
  kagoIgnorePost,
  kagoRemovePost,
} from './menu/post.menu.js';
import {
  kagoApproveComment,
  kagoIgnoreComment,
  kagoRemoveComment,
} from './menu/comment.menu.js';
import { openKagoDashboard } from './menu/subreddit.menu.js';
import { KagoDashboardPost } from './dashboard/dashboard.post.js';
import { scheduleJobs } from './scheduler/jobs.js';

// ──────────────────────────────────────────────────────────
// 1. Configure Devvit capabilities
// ──────────────────────────────────────────────────────────
Devvit.configure({
  redditAPI: true,
  redis: true,
  http: true,
  realtime: true,
});

// ──────────────────────────────────────────────────────────
// 2. Register Triggers
// ──────────────────────────────────────────────────────────

/** Fires on every new post submitted to the subreddit */
Devvit.addTrigger({
  event: 'PostSubmit',
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onEvent: handlePostSubmit as any,
});

/** Fires on every new comment submitted */
Devvit.addTrigger({
  event: 'CommentSubmit',
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onEvent: handleCommentSubmit as any,
});

/** Fires on every moderator action recorded to the modlog —
 *  feeds Kago's adaptive learning with real human ground-truth */
Devvit.addTrigger({
  event: 'ModAction',
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onEvent: handleModAction as any,
});

// ──────────────────────────────────────────────────────────
// 3. Register Menu Actions
// ──────────────────────────────────────────────────────────

// Post menu (visible to moderators on posts)
Devvit.addMenuItem(kagoApprovePost);
Devvit.addMenuItem(kagoRemovePost);
Devvit.addMenuItem(kagoBanUserPost);
Devvit.addMenuItem(kagoIgnorePost);

// Comment menu (visible to moderators on comments)
Devvit.addMenuItem(kagoApproveComment);
Devvit.addMenuItem(kagoRemoveComment);
Devvit.addMenuItem(kagoIgnoreComment);

// Subreddit menu (visible to moderators in the subreddit header)
Devvit.addMenuItem(openKagoDashboard);

// ──────────────────────────────────────────────────────────
// 4. Register Custom Post Type (Dashboard)
// ──────────────────────────────────────────────────────────
// KagoDashboardPost is registered via Devvit.addCustomPostType()
// inside dashboard.post.ts — importing it here executes that registration.
void KagoDashboardPost;

// ──────────────────────────────────────────────────────────
// 5. App Install / Upgrade Lifecycle
// ──────────────────────────────────────────────────────────

/** On first install: schedule background jobs and greet mods */
Devvit.addTrigger({
  event: 'AppInstall',
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onEvent: async (_event: any, context: any) => {
    console.log('[Kago] App installed — scheduling background jobs…');
    try {
      await scheduleJobs(context);
      console.log('[Kago] Background jobs scheduled.');
    } catch (err) {
      console.error('[Kago] Failed to schedule jobs on install:', err);
    }
  },
});

/** On upgrade: reschedule jobs in case of job-name changes */
Devvit.addTrigger({
  event: 'AppUpgrade',
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onEvent: async (_event: any, context: any) => {
    console.log('[Kago] App upgraded — rescheduling background jobs…');
    try {
      await scheduleJobs(context);
    } catch (err) {
      console.error('[Kago] Failed to reschedule jobs on upgrade:', err);
    }
  },
});

// ──────────────────────────────────────────────────────────
// Export (required by Devvit bundler)
// ──────────────────────────────────────────────────────────
export default Devvit;
