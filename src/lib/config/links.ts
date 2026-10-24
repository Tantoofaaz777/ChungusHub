import { PROJECT_URL } from '$shared/project';

/** Outbound links used by About. Retired community and bug-report surfaces have no links. */
export const LINKS = {
	repo: PROJECT_URL,
	license: `${PROJECT_URL}/blob/main/LICENSE`,
	/** The one address here that never leaves the machine: the bundled typefaces' own notice,
	 *  which ships in `static/fonts/` and is served beside them. A license the app hands the
	 *  reader has to be readable from an install with no internet at all. */
	fontLicense: '/fonts/OFL.txt'
} as const;
