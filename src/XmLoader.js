"use strict";

/**
 * XmLoader.js
 *
 * Loader for XM modules. Returns a generic ScripTracker Module object for playback.
 *
 * Author:  		Maarten Janssen
 * Date:    		2014-05-12
 * Last updated:	2015-04-26
 */
ModuleLoaders.loadXM = function (fileData) {
	var mod  = new Module ();
	mod.type = Module.Types.XM;

	var headerSize      = ModuleLoaders.readDWord(fileData, 60);
	var offset          = 0;

	mod.name            = ModuleLoaders.readString(fileData, 17, 20);
	mod.songLength      = ModuleLoaders.readWord(fileData, 64);
	mod.restartPosition = ModuleLoaders.readWord(fileData, 66);
	mod.channels        = Math.min(ModuleLoaders.readWord(fileData, 68), 32);		// Hard limit number of channels to 32
	mod.patternCount    = ModuleLoaders.readWord(fileData, 70);
	mod.instrumentCount = ModuleLoaders.readWord(fileData, 72);
	mod.defaultTempo    = ModuleLoaders.readWord(fileData, 76);
	mod.defaultBPM      = ModuleLoaders.readWord(fileData, 78);

	for (var i = 0; i < mod.songLength; i ++) {
		mod.orders.push (fileData[80 + i]);
	}

	// Decode pattern data.
	offset += headerSize + 60;
	for (var p = 0; p < mod.patternCount; p ++) {
		var pHeaderSize = ModuleLoaders.readDWord(fileData, offset);
		var pRows       = ModuleLoaders.readWord (fileData, offset + 5);
		var pDataSize   = ModuleLoaders.readWord (fileData, offset + 7);

		var pattern = new Module.Pattern(pRows, mod.channels);
		pattern.patternIndex = p;

		if (pDataSize != 0) {
			var pDataOffset = offset + pHeaderSize;
			var lastSample  = 0;

			for (var r = 0; r < pRows; r ++) {
				for (var c = 0; c < mod.channels; c ++) {
					var note = fileData[pDataOffset ++];

					// Regular note info.
					if ((note & 0x80) == 0) {
						pattern.note[r][c]       = note;
						pattern.instrument[r][c] = fileData[pDataOffset ++];
						var volume = Math.max(-1, fileData[pDataOffset ++] - 16);
						/*
						if (volume >= 16 && volume <= 80) {
							pattern.volume[r][c] = Math.min((volume - 16) / 64, 1.0);
						} else {
							pattern.volume[r][c] = 0;
						}
						*/
						pattern.volume[r][c]      = volume;
						pattern.effect[r][c]      = fileData[pDataOffset ++];
						pattern.effectParam[r][c] = fileData[pDataOffset ++];

					// Packed note info.
					} else {
						if ((note & 0x01) != 0) pattern.note[r][c]       = fileData[pDataOffset ++];
						if ((note & 0x02) != 0) pattern.instrument[r][c] = fileData[pDataOffset ++];

						// Get channel volume.
						if ((note & 0x04) != 0) {
							var volume = Math.max(-1, fileData[pDataOffset ++] - 16);
							/*
							if (volume >= 16 && volume <= 80) {
								pattern.volume[r][c] = Math.min((volume - 16) / 64, 1.0);
							} else {
								// TODO: effects from volume data
								pattern.volume[r][c] = -1.0;
							}
							*/
							pattern.volume[r][c] = volume;
						} else {
							pattern.volume[r][c] = -1.0;
						}

						if ((note & 0x08) != 0) pattern.effect[r][c]      = fileData[pDataOffset ++];
						if ((note & 0x10) != 0) pattern.effectParam[r][c] = fileData[pDataOffset ++];
						
						// If we have an effect param, but no effect treat the effect as 0.
						if ((note & 0x08) == 0 && (note & 0x10) != 0) {
							pattern.effect[r][c] = 0;
						}
					}

					// Decode the effect if there is one.
					if (pattern.effect[r][c] != Effects.NONE) {
						pattern.effect[r][c] = parseEffect(pattern.effect[r][c], pattern.effectParam[r][c]);
					}
				}
			}
		}

		mod.patterns.push(pattern);
		offset += pHeaderSize + pDataSize;
	}

	// Read instrument and sample data.
	for (var i = 0; i < mod.instrumentCount; i ++) {
		var instrument        = new Module.Instrument();
		var instrumentSize    = ModuleLoaders.readDWord(fileData, offset);
		instrument.name       = ModuleLoaders.readString(fileData, offset + 4, 22);
		instrument.type       = fileData[offset + 26];
		instrument.numSamples = ModuleLoaders.readWord(fileData, offset + 27);

		if (instrument.numSamples == 0) {
			offset += instrumentSize;
		} else {
			// Read instrument keymap form instrument --> sample linking.
			// For now load sample indexes, after loading sample data replace indexes by sample references.
			for (var k = 0; k < 96; k ++) {
				instrument.sampleKeyMap[k] = fileData[offset + 33 + k];
			}

			// Create volume envelope.
			var volumeEnvelope     = new Module.Envelope();
			volumeEnvelope.type    = fileData[offset + 233];
			var volEnvelopePoints  = fileData[offset + 225];
			var volEnvelopeSustain = fileData[offset + 227]; 
			var volEnvelopeLpBegin = fileData[offset + 228];
			var volEnvelopeLpEnd   = fileData[offset + 229];

			// Create panning envelope.
			var panEnvelope        = new Module.Envelope();
			panEnvelope.type       = fileData[offset + 234];
			var panEnvelopePoints  = fileData[offset + 226];
			var panEnvelopeSustain = fileData[offset + 230];
			var panEnvelopeLpBegin = fileData[offset + 231];
			var panEnvelopeLpEnd   = fileData[offset + 232];

			// Read volume and panning envelope data.
			for (var ep = 0; ep < 12; ep ++) {
				if (ep < volEnvelopePoints) {
					volumeEnvelope.addPoint(
						ModuleLoaders.readWord(fileData, offset + 129 + ep * 4), 
						Math.min (ModuleLoaders.readWord(fileData, offset + 131 + ep * 4) / 64, 1),
						ep == volEnvelopeSustain,
						ep == volEnvelopeLpBegin,
						ep == volEnvelopeLpEnd
					);
				}

				if (ep < panEnvelopePoints) {
					panEnvelope.addPoint(
						ModuleLoaders.readWord(fileData, offset + 177 + ep * 4), 
						Math.min (ModuleLoaders.readWord(fileData, offset + 179 + ep * 4) / 64, 1),
						ep == panEnvelopeSustain,
						ep == panEnvelopeLpBegin,
						ep == panEnvelopeLpEnd
					);
				}
			}

			instrument.volumeEnvelope  = volumeEnvelope;
			instrument.panningEnvelope = panEnvelope;
			offset += instrumentSize;

			// Load sample headers.
			for (var s = 0; s < instrument.numSamples; s ++) {
				var sample = new Module.Sample();

				sample.sampleLength = ModuleLoaders.readDWord(fileData, offset);
				sample.loopStart    = ModuleLoaders.readDWord(fileData, offset + 4);
				sample.loopLength   = ModuleLoaders.readDWord(fileData, offset + 8);
				sample.volume       = fileData[offset + 12] / 64.0;
				sample.fineTune     = (fileData[offset + 13] < 128) ? fileData[offset + 13] : -((fileData[offset + 13] ^ 0xFF) + 1);
				sample.loopType     = (sample.loopLength > 0) ? (fileData[offset + 14] & 0x03) : Module.Sample.SampleLoop.LOOP_NONE;
				sample.dataType     = ((fileData[offset + 14] & 0x10) == 0) ? Module.Sample.SampleFormat.FORMAT_8BIT : Module.Sample.SampleFormat.FORMAT_16BIT;
				sample.panning      = fileData[offset + 15] / 255.0;
				sample.basePeriod   = fileData[offset + 16];
				sample.dataType    |= (fileData[offset + 17] == 0xAD) ? Module.Sample.SampleFormat.TYPE_ADPCM : Module.Sample.SampleFormat.TYPE_DELTA;
				sample.name         = instrument.name;	//fileData.substring (offset + 18, offset + 40);

				// Correct sample base period.
				if (sample.basePeriod > 127) sample.basePeriod = -(256 - sample.basePeriod);
				sample.basePeriod = -sample.basePeriod + 24;

				instrument.samples.push(sample);
				offset += 40;
			}
			
			// Load sample data.
			for (var s = 0; s < instrument.numSamples; s ++) {
				var sample = instrument.samples[s];

				if (sample.sampleLength > 0) {
					var sampleData = fileData.subarray(offset, offset + sample.sampleLength);
					var is16Bit    = (sample.dataType & Module.Sample.SampleFormat.FORMAT_16BIT) != 0;

					if ((sample.dataType & Module.Sample.SampleFormat.TYPE_DELTA) == 0) {
						sample.loadDeltaSample(sampleData, is16Bit);
					} else {
						sample.loadAdpcmSample(sampleData, is16Bit);
					}

					offset += sample.sampleLength;

					// Correct sample length...
					if ((sample.dataType & Module.Sample.SampleFormat.FORMAT_16BIT) != 0) {
						sample.sampleLength /= 2;
						sample.loopStart    /= 2;
						sample.loopLength   /= 2;
					}
				}
			}
		}

		// Add instrument to module.
		mod.instruments.push (instrument);
	}

	return mod;


	function parseEffect (effect, param) {
		switch (effect) {
			case 0:
				return Effects.ARPEGGIO;
			case 1:
				return Effects.PORTA_UP;
			case 2:
				return Effects.PORTA_DOWN;
			case 3:
				return Effects.TONE_PORTA;
			case 4:
				return Effects.VIBRATO;
			case 5:
				return Effects.TONE_PORTA_VOL_SLIDE;
			case 6:
				return Effects.VIBRATO_VOL_SLIDE;
			case 7:
				return Effects.TREMOLO;
			case 8:
				return Effects.SET_PAN;
			case 9:
				return Effects.SAMPLE_OFFSET;
			case 10:
				return Effects.VOLUME_SLIDE;
			case 11:
				return Effects.POSITION_JUMP;
			case 12:
				return Effects.SET_VOLUME;
			case 13:
				return Effects.PATTERN_BREAK;
			case 14:
				var extend = (param & 0xF0) >> 4;
				
				switch (extend) {
					case 1:
						return Effects.FINE_PORTA_UP;
					case 2:
						return Effects.FINE_PORTA_DOWN;
					case 3:
						return Effects.SET_GLISANDO;
					case 4:
						return Effects.SET_VIBRATO;
					case 5:
						return Effects.SET_FINETUNE;
					case 6:
						return Effects.SET_LOOP;
					case 7:
						return Effects.SET_TREMOLO;
					case 9:
						return Effects.RETRIGGER;
					case 10:
						return Effects.FINE_VOL_SLIDE_UP;
					case 11:
						return Effects.FINE_VOL_SLIDE_DOWN;
					case 12:
						return Effects.CUT_NOTE;
					case 13:
						return Effects.DELAY_NOTE;
					case 14:
						return Effects.DELAY_PATTERN;
					default:
						return Effects.NONE;
				}
			case 15:
				return Effects.SET_TEMPO_BPM;
			case 16:
				return Effects.SET_GLOBAL_VOLUME;
			case 17:
				return Effects.GLOBAL_VOLUME_SLIDE;
			case 21:
				return Effects.ENVELOPE_POSITION;
			case 25:
				return Effects.PAN_SLIDE;
			case 27:
				return Effects.RETRIG_VOL_SLIDE;
			case 29:
				return Effects.TREMOR;
			case 33:
				var extend = (param & 0xF0) >> 4;
				
				switch (extend) {
					case 1:
						return Effects.EXTRA_FINE_PORTA_UP;
					case 2:
						return Effects.EXTRA_FINE_PORTA_DOWN;
					default:
						return Effects.NONE;
				}
			default:
				return Effects.NONE;
		}
	}
}