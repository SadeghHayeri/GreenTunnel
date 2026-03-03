import xo from 'eslint-config-xo';

export default [
	...xo,
	{
		rules: {
			'no-await-in-loop': 'off',
			'guard-for-in': 'off',
			'require-atomic-updates': 'off',
		},
	},
];
