import consola from 'consola';

export default function getLogger(name) {
	return consola.withTag('green-tunnel:' + name);
}
