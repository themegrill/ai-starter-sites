// Step 3b: decide which section groups fit the business. Rules over the
// brief's capabilities, no extra LLM call: a conditional group is dropped when
// the business lacks something it needs, kept when it has everything, and
// repurposed (copy rewritten to fit) when that is unclear.
import { Capability, ManifestGroup, ManifestPage, SectionRole } from '../demos/types';
import { Brief } from './brief';
import { editableSlots } from './copy';

export type GroupAction = 'keep' | 'drop' | 'repurpose';

export type GroupDecision = { group: ManifestGroup; action: GroupAction; reason?: string };

const MIN_GROUPS = 3;

const ROLE_LABEL: Partial<Record<SectionRole, string>> = {
	pricing: 'pricing plans',
	gallery: 'portfolio',
	team: 'team',
	logos: 'client logos',
	stats: 'stats',
	posts: 'blog posts',
	dynamic: 'product listing',
};

const CAPABILITY_LABEL: Record<Capability, string> = {
	pricing_plans: 'pricing plans',
	portfolio: 'a portfolio',
	team: 'a team to introduce',
	client_logos: 'client logos to show',
	products: 'products sold online',
	menu: 'a menu',
	classes_schedule: 'a class schedule',
	blog: 'a blog',
	stats: 'stats to show',
};

// What a repurposed group can become, for the copywriter.
const REPURPOSE_HINT: Partial<Record<SectionRole, string>> = {
	pricing: 'packages, rates or ways to buy that this business really offers',
	gallery: 'a showcase of this business’s own products, work or premises',
	team: 'the people behind this business',
	stats: 'short facts about this business, without inventing numbers',
	posts: 'helpful tips or guides related to this business',
	dynamic: 'what this business offers',
};

export const groupLabel = (group: ManifestGroup) => group.title ?? ROLE_LABEL[group.role] ?? group.role;

const textSlots = (page: ManifestPage, group: ManifestGroup) =>
	page.sections.filter((s) => group.sectionIds.includes(s.id)).reduce((n, s) => n + editableSlots(s).length, 0);

// A group can only be rewritten for the business if it has copy to rewrite.
const canRepurpose = (page: ManifestPage, group: ManifestGroup) => !!REPURPOSE_HINT[group.role] && textSlots(page, group) > 0;

export const decideGroups = (page: ManifestPage, brief: Brief): GroupDecision[] => {
	const lastCta = [...page.groups].reverse().find((g) => g.role === 'cta');
	const decisions: GroupDecision[] = page.groups.map((group, index) => {
		const requires = group.fit.kind === 'conditional' ? group.fit.requires ?? [] : [];
		if (!requires.length || index === 0 || group.role === 'hero' || group === lastCta) {
			return { group, action: 'keep' };
		}
		const missing = requires.filter((c) => brief.capabilities[c] === false);
		if (missing.length) {
			return {
				group,
				action: 'drop',
				reason: `A ${brief.businessType} usually doesn’t have ${missing.map((c) => CAPABILITY_LABEL[c]).join(' or ')}.`,
			};
		}
		if (requires.every((c) => brief.capabilities[c] === true)) return { group, action: 'keep' };
		// Unclear: rewrite it to fit when its layout allows, else keep the design's choice.
		return { group, action: canRepurpose(page, group) ? 'repurpose' : 'keep' };
	});

	// Never leave a page thin: bring back the dropped groups with the most copy.
	const dropped = decisions
		.filter((d) => d.action === 'drop')
		.sort((a, b) => textSlots(page, b.group) - textSlots(page, a.group));
	let kept = decisions.length - dropped.length;
	for (const decision of dropped) {
		if (kept >= Math.min(MIN_GROUPS, decisions.length)) break;
		decision.action = canRepurpose(page, decision.group) ? 'repurpose' : 'keep';
		delete decision.reason;
		kept++;
	}
	return decisions;
};

// Copywriter note for a section in a repurposed (or restored) group.
export const repurposeNote = (group: ManifestGroup, brief: Brief) =>
	`This section was designed as ${ROLE_LABEL[group.role] ?? group.role} for a different kind of business. Rewrite it as ${
		REPURPOSE_HINT[group.role] ?? 'something this business really offers'
	}, for a ${brief.businessType}. Keep the same structure.`;
