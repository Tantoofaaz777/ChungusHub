interface Option {
	id: string;
	name: string;
}

export interface NewChatChoices {
	presetId?: string;
	characterVersionId?: string;
	personaVersionId?: string;
}

export interface NewChatStep {
	key: keyof NewChatChoices;
	title: string;
	options: readonly Option[];
}

export function planNewChatSetup(
	presets: readonly Option[],
	characterVersions: readonly Option[],
	personaVersions: readonly Option[]
): { steps: NewChatStep[]; choices: NewChatChoices } {
	const groups: NewChatStep[] = [
		{ key: 'presetId', title: 'Choose a preset', options: presets },
		{ key: 'characterVersionId', title: 'Choose a card version', options: characterVersions },
		{ key: 'personaVersionId', title: 'Choose a persona version', options: personaVersions }
	];
	const steps: NewChatStep[] = [];
	const choices: NewChatChoices = {};
	for (const group of groups) {
		if (group.options.length > 1) steps.push(group);
		else if (group.options.length === 1) choices[group.key] = group.options[0].id;
	}
	return { steps, choices };
}
