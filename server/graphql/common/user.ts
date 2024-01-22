import config from 'config';
import { pick } from 'lodash';

import { activities } from '../../constants';
import { CollectiveType } from '../../constants/collectives';
import roles from '../../constants/roles';
import cache, { fetchCollectiveId } from '../../lib/cache';
import emailLib from '../../lib/email';
import logger from '../../lib/logger';
import { Activity, Collective, Op, sequelize, Update, User } from '../../models';
import { ValidationFailed } from '../errors';

type CreateUserOptions = {
  organizationData?: {
    name: string;
    slug: string;
    website?: string;
    twitterHandle?: string;
    githubHandle?: string;
  };
  sendSignInLink?: boolean;
  throwIfExists?: boolean;
  redirect?: string;
  websiteUrl?: string;
  creationRequest?: {
    ip: string;
    userAgent: string;
  };
};

export const createUser = (
  userData: {
    name?: string;
    legalName?: string;
    email: string;
    newsletterOptIn: boolean;
    location: Record<string, unknown>;
  },
  { organizationData, sendSignInLink, throwIfExists, redirect, websiteUrl, creationRequest }: CreateUserOptions,
): Promise<{ user: User; organization?: Collective }> => {
  return sequelize.transaction(async transaction => {
    let user = await User.findOne({ where: { email: userData.email.toLowerCase() }, transaction });

    if (throwIfExists && user) {
      throw new ValidationFailed(
        'It looks like that email already exists, please sign in instead',
        'EMAIL_ALREADY_EXISTS',
      );
    } else if (!user) {
      // Create user
      user = await User.createUserWithCollective(userData, transaction);
      user = await user.update({ data: { creationRequest } }, { transaction });
    }

    let organization;
    // Create organization
    if (organizationData) {
      const organizationParams = {
        type: CollectiveType.ORGANIZATION,
        CreatedByUserId: user.id,
        ...pick(organizationData, [
          'name',
          'legalName',
          'slug',
          'description',
          'website',
          'twitterHandle',
          'githubHandle',
          'repositoryUrl',
        ]),
      };
      organization = await Collective.create(organizationParams, { transaction });
      await organization.addUserWithRole(user, roles.ADMIN, { CreatedByUserId: user.id }, {}, transaction);
    }

    // Sent signIn link
    if (sendSignInLink) {
      const loginLink = user.generateLoginLink(redirect, websiteUrl);
      if (config.env === 'development') {
        logger.info(`Login Link: ${loginLink}`);
      }
      await emailLib.send(activities.USER_NEW_TOKEN, user.email, { loginLink }, { sendEvenIfNotProduction: true });
      await Activity.create(
        {
          type: activities.USER_NEW_TOKEN,
          UserId: user.id,
          CollectiveId: user.CollectiveId,
          FromCollectiveId: user.CollectiveId,
          data: { notify: false },
        },
        { transaction },
      );
    }
    return { user, organization };
  });
};

export const hasSeenLatestChangelogEntry = async (user: User): Promise<boolean> => {
  const cacheKey = 'latest_changelog_publish_date';
  let latestChangelogUpdatePublishDate = await cache.get(cacheKey);
  // Make sure we don't show the changelog notifications for newly confirmed users
  const userChangelogViewDate = user.changelogViewDate || user.confirmedAt || user.createdAt;
  if (latestChangelogUpdatePublishDate) {
    return userChangelogViewDate >= new Date(latestChangelogUpdatePublishDate);
  } else {
    const collectiveId = await fetchCollectiveId('opencollective');
    const latestChangelogUpdate = await Update.findOne({
      where: {
        CollectiveId: collectiveId,
        publishedAt: { [Op.ne]: null },
        isChangelog: true,
      },
      order: [['publishedAt', 'DESC']],
    });

    latestChangelogUpdatePublishDate = latestChangelogUpdate?.publishedAt;
    if (!latestChangelogUpdatePublishDate) {
      return true;
    }
    // keep the latest change log publish date for a day in cache
    cache.set(cacheKey, latestChangelogUpdatePublishDate, 24 * 60 * 60);
  }
  return userChangelogViewDate >= latestChangelogUpdatePublishDate;
};
