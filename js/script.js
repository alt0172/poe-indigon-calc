var globalPrecision = 3; // used to round everything
var tblRows = 0;
var exportStr = '';

// 1. Variables from form

var emulatingTime;
var actionTime;
var noleechTime;

var indigonCost;
var indigonDmg;

var manacost;
var manacostInc;		// global (non-indigon) mana cost increases (fevered mind, apep's rage)
var manacostFlat;		// elreon/vaal jewelry (-8), doedre gloves (+50)
var manaPrecast;

var manaMax;
var manaUnreserved;
var manaRegen;
var manaRegenAfterDegen;
var manaRestoreChance;	// chance to recover 10% of max mana - trickster/clarity watcher's eye/insanity crafted amulet
						// for simplicity and smoothness is calculated as 
						//(10% of max mana * chance) gained mana after each action (attack/cast)
var manaRecoveryRate;	// clarity watcher's eye/shaper belt (affect manaregen (pob already did it), mana leech and mana from flask)
//leech
var manaLeechDisabled;
var manaLeechedPerSec;	// bonuses from tree
var manaLeechRate;		// bonuses from tree
//flask
var manaFlaskRecovery;	// from belts/tree
var flaskEffect			// tree/pf (sums with mana flask effect)
var flaskAmount;
var flaskDuration;

// 2. Calculated later
//var singleBonus;		//Object: .str = bonus strength (1 for 200 mana, 2 for 400, etc), .timeLeft = time left
var bonuses;			// array of 'singleBonus' items
var bonusesActive;
var maxBonusesReached;
var maxBonusesReachedTime;

var bonusesStatistic_all;

var manaSpentSinceLastBonusActivation;

var manacostBase;
var manaLeft;
var manaDegen;
//var totalManaPerSecondGain;
var manaLeechCap;

var manaFromFlaskGainedPerSecond = 0;
var manaFromRegenGainedPerSecond = 0;

var timespent   = 0;
var hitsDone    = 0;
var currentMode = '';
var mapRecoveryModifier = 1;

function round( num ){
	var digits = globalPrecision;
	if ( arguments.length>1) {
		digits = arguments[1];
	}
	var tmp = Math.pow( 10, digits );
	return Math.round(num * tmp)/tmp;
}

function getFromForm(id){	// id, [min, max]
	var tmp = document.getElementById(id);
	var res = tmp.value;
	
	if ( res !== "" ) {
		res = Number(res);
		if ( isNaN(res) ) {
			res = Number(tmp.placeholder);
			tmp.value = res;
		}
	} else {
		res = Number(tmp.placeholder);
	}
	
	//min handling
	if ( arguments.length>1 ){
		let min = arguments[1];
		if ( res < min ){
			res = min;
			tmp.value = res;
		}
	}
	
	//max handling
	if ( arguments.length>2 ){
		let max = arguments[2];
		if ( res > max ){
			res = max;
			tmp.value = res;
		}
	}
	
	return res;
}
function resetOtherVars(){
	manacost     = getFromForm('mana_cost');
	
	hitsDone              = 0;
	bonuses               = [];
	bonusesActive         = 0;
	maxBonusesReached     = 0;
	maxBonusesReachedTime = 0;
	manaSpentSinceLastBonusActivation = manaPrecast;
	
	manaLeft          = Math.min( manaMax,manaUnreserved );
	manacostBase      = calcBaseManacost();
	manaLeechCap      = calcManaLeechCap();
	manaDegen         = manaRegen - manaRegenAfterDegen;
	
	mapRecoveryModifier = 1;
}

function setVars(){
	emulatingTime = getFromForm('emulation_time',1 ,120);
	actionTime    = getFromForm('action_time', 0.01, 4);
	noleechTime   = getFromForm('noleech_time', 0, emulatingTime);
	
	indigonCost   = getFromForm('indigon_cost', 50, 60);
	indigonDmg    = getFromForm('indigon_dmg', 50, 60);


	manacost      = getFromForm('mana_cost');
	manacostInc   = getFromForm('mana_incred');
	manacostFlat  = getFromForm('mana_flat');

	manaMax             = getFromForm('mana_max');
	manaUnreserved      = getFromForm('mana_unreserved', 0, manaMax);
	manaRegen           = getFromForm('mana_regen');
	manaRegenAfterDegen = getFromForm('mana_regen_after_degen', -2000, manaRegen);
	manaRecoveryRate    = getFromForm('mana_recov');
	manaRestoreChance   = getFromForm('mana_restore', 0, 100);
	manaPrecast         = getFromForm('mana_precast', 0, manaUnreserved);
	
	//flask
	flaskAmount         = getFromForm('flask_amount');
	flaskDuration       = getFromForm('flask_dur');
	manaFlaskRecovery   = getFromForm('flask_increc');
	flaskEffect         = getFromForm('flask_inceff');
	//leech
	manaLeechedPerSec   = getFromForm('leech_per_sec');
	manaLeechRate       = getFromForm('leech_max_rate');
	
	//manaLeechDisabled   = document.getElementById('disable_leech').checked;

	bonusesStatistic_all = [];
	
	resetOtherVars();
}

function calcBaseManacost(){
	return round( (manacost - manacostFlat) / (1+manacostInc/100) );
}

function calcManacost(){
	var totalCostInc = indigonCost*bonusesActive + manacostInc;
	return Math.floor( manacostBase*(1+totalCostInc/100) + manacostFlat );
}

function calcManaLeechCap(){
	return round( manaMax*(0.2 + manaLeechRate/100) );
}

function calcManaFromOneLeechPerSec(){
	var res;
	res  = manaMax*0.02;					// default leech from 1 instance
	res *= (1 + manaLeechedPerSec/100);		// apply "mana leeched per second" bonus
	res  = Math.min(res, manaLeechCap);		// cap leech at max rate (should not happen with 1 instance, but whatever)
	return round(res);
}

function calcManaFromLeechPerSec(){
	if (currentMode === 'no_leech') {
		return 0;
	}
	
	var res;
	if ( hitsDone > (10 + manaLeechRate/2) ) {
		// leech is always capped after 10 hits (without "maximum Mana Leech rate" bonuses)
		// if cap is increased: each hit leeches 2%, so extra hits amount is cap increase / 2
		res = manaLeechCap;
	} else {
		res = hitsDone * calcManaFromOneLeechPerSec();	// otherwise some math has to be done
		res = Math.min( res, manaLeechCap );			// cap leech if needed
	}
	
	
	res *= (1 + manaRecoveryRate/100);		// apply mana recovery from items
	
	if ( mapRecoveryModifier != 1 ) {		// apply map "Less recovery" penalty if there is one
		res *= mapRecoveryModifier;
	}
	
	return round(res);
}

function calcManaFromRegenPerSec(){
	var res=0;
	
	if ( currentMode !== 'no_regen' ) {
		res += manaRegen;					// mana regen (from PoB) already counts mana recovery from items
	}	
	
	if ( mapRecoveryModifier != 1 ) {		// apply map "Less recovery" penalty if there is one
		res *= mapRecoveryModifier;
	}
	
	res -= manaDegen; 						// mana degen isn't affected by map mod
	return res;
}

function calcManaFromFlaskPerSec(){
	//always active
	if (flaskDuration==0) return 0;
	
	var rate = flaskAmount/flaskDuration;				// base recovery rate
	rate *= (1+(manaFlaskRecovery+flaskEffect)/100);	// apply "mana recovery from flasks"/flask effect
	rate *= (1 + manaRecoveryRate/100);					// apply mana recovery rate multiplier
	
	if ( mapRecoveryModifier != 1 ) {					// apply map "Less recovery" penalty if there is one
		rate *= mapRecoveryModifier;
	}
	return round(rate);
}

/*
function calcTotalManaGainPerSec(){
	var res = calcManaFromFlaskPerSec() + calcManaFromRegenPerSec();
	
	if ( currentMode !== 'no_leech') {
		res += calcManaFromLeechPerSec();
	}
	return res;
}

function calcManaLeft(){
	var tmp = manaLeft + Math.floor(calcTotalManaGainPerSec() * actionTime);
	return Math.min( tmp, manaUnreserved);
}//*/

function Bonus(str, timeLeft) {
    this.str = str;
    this.timeLeft= timeLeft;
}
function BonusesStatistic( time, manaleft, manacost, manaFromFlask, manaFromRegen, manaFromLeech, bonuses, spelldmg ) {
    this.time           = time;
    this.manaLeft       = manaleft;
    this.manaCost       = manacost;
	
	this.manaFromFlask  = manaFromFlask;
	this.manaFromRegen  = manaFromRegen;
	this.manaFromLeech  = manaFromLeech;
	
    this.bonusesActive  = bonuses;
    this.spellDmg       = spelldmg;
}

function updateBonuses (){
	bonusesActive=0;
	bonuses.forEach(function( item, i, arr ){
		if (item!==0) {//skip old empty elements (should not happen)
			
			item.timeLeft = round(item.timeLeft - actionTime);
			if (item.timeLeft>0) {
				bonusesActive += item.str;
			} else {
				arr[i]=0;				// replace ended bonus with 0
			}
		}
	});
	
	bonuses = bonuses.filter(function(elem){ return elem!==0;});	// clear array from 0 elements
	
	if( bonusesActive > maxBonusesReached) {
		maxBonusesReached     = bonusesActive;
		maxBonusesReachedTime = timespent;
	}
}

function addBonusesIfNeeded(manaSpent){
	var tmp = parseInt(manaSpent/200);
	if (tmp>0) {
		manaSpentSinceLastBonusActivation = manaSpent%200;
		bonuses.push( new Bonus(tmp,4) );
	}
}

function oneAction(){
	// 1 - update bonuses (time has passed, some may be ended)
	updateBonuses();
	
	//2 - calc manacost based on it
	manacost = calcManacost();
	
	//3 - calc mana left
	var manaFromFlask = Math.round( manaFromFlaskGainedPerSecond * actionTime );
	var manaFromRegen = Math.round( manaFromRegenGainedPerSecond * actionTime );
	var manaFromLeech = Math.round( calcManaFromLeechPerSec() * actionTime );

	manaLeft += manaFromFlask + manaFromRegen + manaFromLeech;
	manaLeft = Math.min(manaLeft, manaUnreserved);
	manaLeft = Math.max(manaLeft, 0);
	
	//save some data in "bonusesStatistic_all" object
	var obj = bonusesStatistic_all[ bonusesStatistic_all.length-1 ];
	obj.time.push(timespent);
	obj.manaLeft.push(manaLeft);
	obj.manaCost.push(manacost);
	obj.manaFromFlask.push(manaFromFlask);
	obj.manaFromRegen.push(manaFromRegen);
	obj.manaFromLeech.push(manaFromLeech);
	obj.bonusesActive.push(bonusesActive);
	obj.spellDmg.push( Math.round(bonusesActive*indigonDmg) );
	
	//4 - check if there is enough mana
	if ( manaLeft > manacost ) {
		
		//5 - do action, calc spent mana
		if ( currentMode === 'noleech_time' ) {		// start leeching mana
			if ( timespent > noleechTime ){
				hitsDone++;
			}
		} else {
			hitsDone++;
		}
		manaLeft = Math.floor( manaLeft - manacost + (manaMax*0.1*(manaRestoreChance/100)) );
		manaLeft = Math.min( manaLeft, manaUnreserved );
		
		manaSpentSinceLastBonusActivation += manacost;
		
		//6 - add new bonus if needed
		addBonusesIfNeeded( manaSpentSinceLastBonusActivation );
	}
}

function output_table (){

	var tbody = document.getElementById('detailed_output_all_table');
	
	tblRows = bonusesStatistic_all[0].time.length;
	for (let i=0; i<tblRows; i++){
		
		var tr = document.createElement('tr');
		var cellClass;
		
		addTblCell(tr, bonusesStatistic_all[0].time[i]);	//time
		
		for ( let mode=0; mode<bonusesStatistic_all.length; mode++) {
			if ( bonusesStatistic_all[mode].manaLeft[i] < bonusesStatistic_all[mode].manaCost[i] ){
				cellClass = 'not-enough-mana';
			} else {
				cellClass = '';
			}
			addTblCell( tr, bonusesStatistic_all[mode].manaLeft[i], cellClass );
			addTblCell( tr, bonusesStatistic_all[mode].manaCost[i], cellClass );
			addTblCell( tr, bonusesStatistic_all[mode].manaFromFlask[i]);
			addTblCell( tr, bonusesStatistic_all[mode].manaFromRegen[i]);
			addTblCell( tr, bonusesStatistic_all[mode].manaFromLeech[i]);
			addTblCell( tr, bonusesStatistic_all[mode].bonusesActive[i]);
			addTblCell( tr, bonusesStatistic_all[mode].spellDmg[i]);
		}
			
		tbody.appendChild(tr);
	}
}
function addTblCell( trObj, tdText ) {
	var tmp, tdClass;
	if ( arguments.length>2 ){
		tdClass = arguments[2];
	} else {
		tdClass = '';
	}
	tmp=document.createElement('td');
	tmp.className = tdClass;
	tmp.innerHTML = tdText;
	trObj.appendChild(tmp);
}

function setHTML_id(id, txt){
	document.getElementById(id).innerHTML = txt;
}
function setHTML_id_class(id, classSelector, txt){
	var tmp = document.getElementById(id);
	if ( tmp !== null ) {
		tmp.getElementsByClassName(classSelector)[0].innerHTML = txt;
	}
}

function shortOutput( idSuffix ){
	var index, obj;
	if ( idSuffix === '_max' ) {
		obj = bonusesStatistic_all[3];
	} else {
		obj = bonusesStatistic_all[0];
	}
	// 1. Calc
	var avgVal     = Math.round( calcArrayAverage( obj.spellDmg ) );
	index          = firstTimeArrayValueExceededTarget( obj.spellDmg, avgVal );
	var avgMetAt   = obj.time[index];
	
	var medVal     = Math.round( calcArrayMedian( obj.spellDmg ) );
	index          = firstTimeArrayValueExceededTarget( obj.spellDmg, medVal );
	var medMetAt   = obj.time[index];
	
	var rampingEnd = Math.max( avgMetAt, medMetAt );			// Find "ramping up" part
	index          = firstTimeArrayValueExceededTarget( obj.time, rampingEnd );
	var tmpArr     = obj.spellDmg.slice(index);					// Remove "ramping up" part from calculating
	var platoAvg   = Math.round( calcArrayAverage(tmpArr) );	// Calculate average on remains
	
	// 2. Output
	setHTML_id_class( 'avg_high_dmg'+idSuffix, 'spelldmg-bonus', platoAvg   );
	setHTML_id_class( 'avg_high_dmg'+idSuffix, 'the-time',       rampingEnd );
	
	setHTML_id_class( 'peak_info'+idSuffix,    'spelldmg-bonus', maxBonusesReached*indigonDmg );
	setHTML_id_class( 'peak_info'+idSuffix,    'the-time',       maxBonusesReachedTime        );
	
	setHTML_id_class( 'average_info'+idSuffix, 'spelldmg-bonus', avgVal   );
	setHTML_id_class( 'average_info'+idSuffix, 'the-time',       avgMetAt );
	
	setHTML_id_class( 'median_info'+idSuffix,  'spelldmg-bonus', medVal   );
	setHTML_id_class( 'median_info'+idSuffix,  'the-time',       medMetAt );
	
}

function clearOutput(){
	var tmp=['','_max'];
	for ( let i=0; i<2; i++ ){
		setHTML_id_class( 'avg_high_dmg'+tmp[i], 'spelldmg-bonus', '' );
		setHTML_id_class( 'avg_high_dmg'+tmp[i], 'the-time',       '' );
		
		setHTML_id_class( 'peak_info'+tmp[i],    'spelldmg-bonus', '' );
		setHTML_id_class( 'peak_info'+tmp[i],    'the-time',       '' );
		
		setHTML_id_class( 'average_info'+tmp[i], 'spelldmg-bonus', '' );
		setHTML_id_class( 'average_info'+tmp[i], 'the-time',       '' );
		
		setHTML_id_class( 'median_info'+tmp[i],  'spelldmg-bonus', '' );
		setHTML_id_class( 'median_info'+tmp[i],  'the-time',       '' );
	}
	
	setHTML_id('detailed_output_all_table','');
}

function calcArrayAverage ( arr ){
	var sum = 0;
	arr.forEach(function( item ){
		sum += Number(item);
	});
	return round( sum/arr.length );
}
function calcArrayMedian ( sourceArray ){
	var arr = sourceArray.slice(0);						// copy source array
	arr.sort( function( a, b ) { return a - b; } );		// and sort this copy
	
	var lowMiddle  = Math.floor((arr.length - 1) / 2);
	var highMiddle = Math.ceil((arr.length - 1) / 2);
	return ( ( arr[lowMiddle] + arr[highMiddle] ) / 2 );
}
function firstTimeArrayValueExceededTarget( arr, target ){
	for ( let i=0, l=arr.length; i<l; i++ ){
		if ( arr[i]>=target ) { return i; }
	}
}

function exportFormData(){
	var res = emulatingTime + ';' +
	          actionTime + ';' +
			  noleechTime + ';' +
			  indigonCost + ';' +
			  indigonDmg + ';' +
			  manacost + ';' +
			  manacostInc + ';' +
			  manacostFlat + ';' +
			  manaMax + ';' +
			  manaUnreserved + ';' +
			  manaRegen + ';' +
			  manaRegenAfterDegen + ';' +
			  manaRecoveryRate + ';' +
			  manaRestoreChance + ';' +
			  manaPrecast + ';' +
			  flaskAmount + ';' +
			  flaskDuration + ';' +
			  manaFlaskRecovery + ';' +
			  flaskEffect + ';' +
			  manaLeechedPerSec + ';' +
			  manaLeechRate; 
	//
	location.hash = '#' + res;
}
function importFormData(){
	var str = location.hash.substring(1);
	if ( str == '' ) {
		return;
	}
	var arr = str.split(';');
	if ( arr.length != 21 ){
		return;
	}
	
	document.getElementById('emulation_time').value = arr[0];
	document.getElementById('action_time').value    = arr[1];
	document.getElementById('noleech_time').value   = arr[2];
	
	document.getElementById('indigon_cost').value   = arr[3];
	document.getElementById('indigon_dmg').value    = arr[4];
	
	document.getElementById('mana_cost').value      = arr[5];
	document.getElementById('mana_incred').value    = arr[6];
	document.getElementById('mana_flat').value      = arr[7];
	
	document.getElementById('mana_max').value       = arr[8];
	document.getElementById('mana_unreserved').value = arr[9];
	
	document.getElementById('mana_regen').value     = arr[10];
	document.getElementById('mana_regen_after_degen').value = arr[11];
	document.getElementById('mana_recov').value     = arr[12];
	
	document.getElementById('mana_restore').value   = arr[13];
	document.getElementById('mana_precast').value   = arr[14];
	
	document.getElementById('flask_amount').value   = arr[15];
	document.getElementById('flask_dur').value      = arr[16];
	document.getElementById('flask_increc').value   = arr[17];
	
	document.getElementById('flask_inceff').value   = arr[18];
	document.getElementById('leech_per_sec').value  = arr[19];
	document.getElementById('leech_max_rate').value = arr[20];
}

function emulate(mode){
	currentMode = mode;
	bonusesStatistic_all.push( new BonusesStatistic([],[],[],[],[],[],[],[]) );
	
	if ( manaPrecast > 0 ) {
		addBonusesIfNeeded( manaSpentSinceLastBonusActivation );
		manaLeft -= manaPrecast;
		timespent = actionTime;
	} else {
		timespent = 0;
	}
	
	manaFromFlaskGainedPerSecond = calcManaFromFlaskPerSec();
	manaFromRegenGainedPerSecond = calcManaFromRegenPerSec();
	
	do {
		oneAction();
		timespent = round(timespent+actionTime);
	} while ( timespent < emulatingTime );
}


function main(){
	//importFormData();
	
	clearOutput();
	setVars();
	
	exportFormData();
	
	
	emulate('no_leech');
	
	resetOtherVars();
	emulate('no_regen');
	
	resetOtherVars();
	emulate('noleech_time');
	
	resetOtherVars();
	emulate('max_leech');
	
	
	shortOutput('_max');
	output_table();
	buildChart();
}
function buildChart(){
	if ( typeof Highcharts == 'undefined' ){ 
		setHTML_id( 'container', '<span style="align:center;">Highcharts script not loaded</span>' );
		return;
	}
	
	//*
	Highcharts.chart('container', {

		title: {
			text: 'Indigon Spell Damage Bonus over '+emulatingTime+' seconds'
		},
		
		xAxis: {
			categories: bonusesStatistic_all[0].time/*,
			crosshair: true//*/
		},
		yAxis: {
			title: {
				text: '%Spell damage'
			}
		},
		plotOptions: {
			series: {
				marker: {
					radius: 2
				}
			}
		},//*/
		 tooltip: {
            /*pointFormat: '<span style="color:{series.color}">{series.name}</span>: <b>{point.y}</b><br/>',
            valueDecimals: 0,
            split: true/**/
			shared: true
        },
		series: [{
			name: 'No leech',
			data: bonusesStatistic_all[0].spellDmg
		}, {
			name: 'No regen',
			data: bonusesStatistic_all[1].spellDmg
		}, {
			name: 'No leech at start',
			data: bonusesStatistic_all[2].spellDmg
		}, {
			name: 'Maxed leech',
			data: bonusesStatistic_all[3].spellDmg
		}]

	});
	//*/
}