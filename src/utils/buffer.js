export function bufferToChunks(buffer, chunkSize, recordFragmentation) {
	if(recordFragmentation) buffer=tlsRecordFragmentation(buffer, chunkSize)
	const result = [];
	const len = buffer.length;
	let i = 0;

	while (i < len) {
		result.push(buffer.slice(i, i += chunkSize));
	}

	return result;
}
/**
 * @param {Buffer} buffer
 * @param {number} chunkSize
 */
function tlsRecordFragmentation(buffer, chunkSize) {
	const list = []
	const header = buffer.subarray(0,3)
	const fullRecord = buffer.subarray(5)
	const len = fullRecord.length
	let i = 0

	while (i < len) {
		const record = fullRecord.subarray(i, i+chunkSize)
		const recordLength = record.length
		const buf = Buffer.alloc(recordLength+5)
		header.copy(buf)
		buf.writeUInt16BE(recordLength,3)
		record.copy(buf,5)
		list.push(buf)
		i+=chunkSize
	}
	return Buffer.concat(list)
}
