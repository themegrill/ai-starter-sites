import { config } from '../config';
import { liveGenerator } from './live';
import { mockGenerator } from './mock';
import { Generator } from './types';

export const getGenerator = (): Generator => (config.mock ? mockGenerator : liveGenerator);

export type { GenerateOptions, Generator } from './types';
