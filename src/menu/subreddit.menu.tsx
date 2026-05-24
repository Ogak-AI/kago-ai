// ============================================================
// Kago AI – Subreddit Menu Action
// Creates or navigates to the Kago Dashboard post.
// ============================================================

import { Devvit } from '@devvit/public-api';
import type { MenuItem } from '@devvit/public-api';
import { Keys } from '../constants.js';

export const openKagoDashboard: MenuItem = {
  label: 'Open Kago Dashboard',
  description: 'Create or jump to the pinned Kago AI moderation dashboard for this subreddit.',
  location: 'subreddit',
  forUserType: 'moderator',
  onPress: async (_event, context) => {
    try {
      const subreddit = await context.reddit.getCurrentSubreddit();
      const subredditId = subreddit.id;
      const subredditName = subreddit.name;

      // Check if a dashboard post already exists
      const existingPostId = await context.redis.get(Keys.dashboardPost(subredditId));

      if (existingPostId) {
        // Navigate to existing dashboard
        context.ui.navigateTo(`https://reddit.com/r/${subredditName}/comments/${existingPostId.replace('t3_', '')}/`);
        return;
      }

      // Create a new dashboard post
      const post = await context.reddit.submitPost({
        subredditName,
        title: 'Kago AI — Moderation Dashboard',
        // Custom post type — renders the Devvit interactive UI
        preview: (
          <vstack alignment="center middle" height="100%">
            <image url="kago_logo.png" imageWidth={64} imageHeight={64} />
            <text size="xlarge" weight="bold">Kago AI</text>
            <text size="medium" color="neutral-content-weak">Loading moderation dashboard…</text>
          </vstack>
        ),
      });

      // Store the post ID so we don't duplicate
      await context.redis.set(Keys.dashboardPost(subredditId), post.id);

      // Pin the post to the subreddit
      try {
        await post.sticky(1);
      } catch {
        // Stickying may fail if there are already 2 stickied posts — non-critical
      }

      context.ui.navigateTo(post);
      context.ui.showToast({ text: 'Kago Dashboard created!', appearance: 'success' });
    } catch (err) {
      console.error('[Kago] Failed to create/open dashboard:', err);
      context.ui.showToast({ text: 'Could not open dashboard.', appearance: 'neutral' });
    }
  },
};
