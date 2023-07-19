import '../../server/env.js';
import '../../server/lib/sentry.js';

import PQueue from 'p-queue';

import { activities } from '../../server/constants/index.js';
import { reportErrorToSentry } from '../../server/lib/sentry.js';
import { parseToBoolean } from '../../server/lib/utils.js';
import models, { Op, sequelize } from '../../server/models/index.js';
import VirtualCard, { VirtualCardStatus } from '../../server/models/VirtualCard.js';

const DRY_RUN = process.env.DRY_RUN ? parseToBoolean(process.env.DRY_RUN) : false;

export async function findUnusedVirtualCards() {
  return models.VirtualCard.findAll({
    include: [
      {
        association: 'host',
        required: true,
        where: {
          'settings.virtualcards.autopauseUnusedCards.enabled': true,
        },
      },
      {
        association: 'collective',
        required: true,
      },
    ],
    where: {
      [Op.and]: [
        {
          data: {
            status: VirtualCardStatus.ACTIVE,
          },
        },
        // has the feature period is larger than zero
        sequelize.literal(`
          cast("host".settings#>'{virtualcards,autopauseUnusedCards,period}' as integer) > 0
        `),
        // the card exists longer than the period
        sequelize.literal(`
          "VirtualCard"."createdAt" <= now() - make_interval(
            days => cast("host".settings#>'{virtualcards,autopauseUnusedCards,period}' as integer)
          )
        `),
        // the is no charge made in the period
        sequelize.literal(`
          NOT EXISTS (
            SELECT * FROM "Expenses" e 
            WHERE e."VirtualCardId" = "VirtualCard".id
            AND 
              e."createdAt" >= now() - make_interval(
                days => cast("host".settings#>'{virtualcards,autopauseUnusedCards,period}' as integer)
              )
          )
        `),
      ],
    },
  });
}

async function pauseVirtualCardDueToInactivity(virtualCard: VirtualCard) {
  try {
    console.log('Pausing card', virtualCard.id, virtualCard.name);
    if (DRY_RUN) {
      return;
    }

    await virtualCard.pause();
    await models.Activity.create({
      type: activities.COLLECTIVE_VIRTUAL_CARD_SUSPENDED_DUE_TO_INACTIVITY,
      CollectiveId: virtualCard.collective.id,
      HostCollectiveId: virtualCard.host.id,
      data: {
        virtualCard,
        host: virtualCard.host.info,
        collective: virtualCard.collective.info,
      },
    });
  } catch (e) {
    console.error(e);
    reportErrorToSentry(e);
  }
}

export async function run({ concurrency = 20 } = {}) {
  const unusedVirtualCards = await findUnusedVirtualCards();

  const queue = new PQueue({ concurrency });
  await queue.addAll(unusedVirtualCards.map(vc => () => pauseVirtualCardDueToInactivity(vc)));
}

if (require.main === module) {
  run()
    .catch(e => {
      console.error(e);
      reportErrorToSentry(e);
      process.exit(1);
    })
    .then(() => {
      setTimeout(() => sequelize.close(), 2000);
    });
}
