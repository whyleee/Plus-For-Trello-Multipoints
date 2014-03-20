var g_msFetchTimeout = 15000; //ms to wait on urlFetches. update copy on plus.js
var g_cchTruncateDefault = 55;
var ID_PLUSCOMMAND = "/PLUSCOMMAND";
var PREFIX_PLUSCOMMAND = "^";
var PROP_TRELLOUSER = "plustrellouser";
var PROP_SHOWBOARDMARKERS = "showboardmarkers";
var TAG_RECURRING_CARD = "[R]";
var COLUMNNAME_ETYPE = "E.type";


function assert(condition, message) {
	if (!condition) {
		var log = "Assertion failed. ";
		if (message)
			log += message;
		logPlusError(log);
	}
}

// ETYPE
// stored in HISTORY.eType
// indicates the estimate action on the card (by card by user)
var ETYPE_NONE = 0;
var ETYPE_INCR = 1;
var ETYPE_DECR = -1;
var ETYPE_NEW = 2;

function nameFromEType(eType) {
	if (eType == ETYPE_NONE)
		return "";

	if (eType == ETYPE_INCR)
		return "+E";

	if (eType == ETYPE_DECR)
		return "-E";

	if (eType == ETYPE_NEW)
		return "NEW";
}

function getUrlParams() {
	var iParams = window.location.href.indexOf("?");
	var objRet = {};
	if (iParams < 0)
		return objRet;
	var strParams = window.location.href.substring(iParams + 1);
	var params = strParams.split("&");
	var i = 0;
	for (i = 0; i < params.length; i++) {
		var pair = params[i].split("=");
		objRet[pair[0]] = pair[1];
	}
	return objRet;
}


/* strTruncate
 *
 * truncates a string if larger than length, returns a string at most of length+3
 **/
function strTruncate(str, length) {
	if (length === undefined)
		length = g_cchTruncateDefault;
	if (typeof (str) != 'string')
		str = "" + str;
	if (str.length > length)
		str = str.substr(0, length) + "...";
	return str;
}

function sendExtensionMessage(obj, responseParam, bRethrow) {
	try {
		chrome.extension.sendRequest(obj, function (response) {
			try {
				setTimeout(function () { responseParam(response); }, 0); //this allows the response to be out of the extension messaging stack. exceptions wont break the channel.
			} catch (e) {
				logException(e);
			}
		});
	} catch (e) {
		logException(e);
		if (bRethrow)
			throw e;
	}
}

function logException(e, str) {
	if (str && str != e.message)
		str = str + "," + e.message;
	else
		str = e.message;
	logPlusError(str + " :: " + e.stack, false);
}


var g_plusLogMessages = []; //queues an error log which is regularly purged
var g_lastLogPush = null;

//logPlusError
// bAddStackTrace: defaults to true.
//
function logPlusError(str, bAddStackTrace) {
	var strStack = null;
	var date = new Date();
	if (bAddStackTrace === undefined)
		bAddStackTrace = true;
	if (bAddStackTrace) {
		try {
			throw new Error();
		} catch (e) {
			str = str + " :: " + e.stack;
		}
	}
	console.log(str);
	var pushData = { date: date.getTime(), message: str };
	if (g_lastLogPush != null && (pushData.date - g_lastLogPush.date < 1000 * 60) && pushData.message == g_lastLogPush.message) {
		return; //prevent a crazy error log from overflowing database with duplicate messages in a short time
	}
	g_lastLogPush = pushData;
	g_plusLogMessages.push(pushData);
	setTimeout(function () { //get out of the current callstack which could be inside a db transaction etc
		if (g_callbackPostLogMessage)
			g_callbackPostLogMessage();
	}, 2000);
}

/* setCallbackPostLogMessage
 * must be called once if you want to commit messages to the db
 * will cause a commit one call to push a message (errors etc), plus will attempt commit every minute
 **/
var g_intervalCallbackPostLogMessage = null;
var g_callbackPostLogMessage = null;

function setCallbackPostLogMessage(callback) {
	g_callbackPostLogMessage = callback;
	if (g_intervalCallbackPostLogMessage)
		clearInterval(g_intervalCallbackPostLogMessage);
	//note: callers expect this interval, dont change it.
	g_intervalCallbackPostLogMessage = setInterval(function () {
		callback();
	}, 60000);
}


function getSQLReportShared(sql, values, okCallback, errorCallback) {
	sendExtensionMessage({ method: "getReport", sql: sql, values: values }, function (response) {
		if (response.status != "OK") {
			if (errorCallback)
				errorCallback(response.status);
			return; //dont call  okCallback
		}
		okCallback(response);
	});
}

function selectElementContents(el) {
	if (window.getSelection && document.createRange) {
		//select it just for visual purposes. Extension background will do the actual copy
		var sel = window.getSelection();
		var range = document.createRange();
		range.selectNodeContents(el);
		sel.removeAllRanges();
		sel.addRange(range);

		sendExtensionMessage({ method: "copyToClipboard", html: el.innerHTML }, function (response) {
			if (response.status != "OK")
				return;
			setTimeout(function () { removeSelection(); }, 100); //timeout is only for user visual cue 
		});
	}
}

function removeSelection() {
	if (window.getSelection && document.createRange) {
		var sel = window.getSelection();
		sel.removeAllRanges();
	}
}

//parseFixedFloat
//round floats to two decimals.
//returns a float
function parseFixedFloat(text, bDontZeroNan) {
	var val = parseFloat(text);
	if (isNaN(val)) {
		if (bDontZeroNan)
			return val;
		return 0;
	}
	return Math.round(val * 100) / 100;
}


function addSumToRows(bModifyRows, rows, prefix) {
	prefix = prefix || "";
	var mapRet = {};
	var iRow = 0;
	for (; iRow < rows.length; iRow++) {
		var sum = 0;
		var row = rows[iRow];
		var iCol = 1;
		for (; iCol < row.length; iCol++)
			sum += row[iCol];
		sum = parseFixedFloat(sum);
		if (bModifyRows)
			row[0] = prefix + sum + " " + row[0];
		else
			mapRet[row[0]] = sum;
	}
	return mapRet;
}

function getDrilldownTopButtons(bNoClose, title) {
	bNoClose = bNoClose || false;

	var ret = '<div style="margin-bottom:3px"><p class="agile_drilldown_h">' + title+"</p>";
	if (!bNoClose)
		ret += '<img class="agile_help_close_drilldown"></img>';
	ret += '<img class="agile_drilldown_select"></img></div>';
	return ret;
}

function getHtmlBurndownTooltipFromRows(bShowTotals, rows, bReverse, header, callbackGetRowData, bOnlyTable, title) {
	bOnlyTable = bOnlyTable || false;
	if (title === undefined)
		title = "Plus Drill-down";

	function th(val, bExtend) {
		return "<th class='agile_drill_th" + (bExtend ? " agile_drill_th_extend" : "") + "'>" + val + "</th>";
	}

	function htmlRow(row) {

		function td(val, bNoTruncate) {
			return "<td class='agile_cell_drilldown'>" + (bNoTruncate ? val : strTruncate(val)) + "</td>";
		}

		var tds = callbackGetRowData(row);
		var strPost = "";
		if (tds.title && tds.title != "")
			strPost = " title='" + tds.title + "'";
		var html = "<tr class='agile-drilldown-row'" + strPost + ">";
		var iCol = 0;
		for (; iCol < tds.length; iCol++)
			html += td(tds[iCol].name, tds[iCol].bNoTruncate);
		html += "</tr>";
		return html;
	}

	var html = '';
	var htmlTop = '';

	if (!bOnlyTable) {
		htmlTop += '<div class="agile_tooltipContainer agile_arrow_opened">';
	}

	html += '<div class="agile_tooltip_scroller" tabindex="0">';
	html += '<table class="agile_tooltipTable">';
	html += '<tr class="agile-drilldown-header">';
	var iHeader = 0;
	for (; iHeader < header.length; iHeader++)
		html += th(header[iHeader].name, header[iHeader].bExtend);
	html += '</tr>';
	var sTotal = 0;
	var eTotal = 0;

	if (bReverse) {
		var i = rows.length - 1;
		for (; i >= 0; i--) {
			var row = rows[i];
			html += htmlRow(row);
			sTotal += row.spent;
			eTotal += row.est;
		}
	} else {
		var i = 0;
		for (; i < rows.length; i++) {
			var row = rows[i];
			html += htmlRow(row);
			sTotal += row.spent;
			eTotal += row.est;
		}
	}
	html += '</table>&nbsp<br />'; //extra line fixes table copy, otherwise bottom-right cell loses background color in pasted table.
	html += '</DIV>';
	if (!bOnlyTable)
		html += '</DIV>';
	if (bShowTotals)
		title += (" S:" + parseFixedFloat(sTotal) + "&nbsp;&nbsp;/&nbsp;&nbspE:" + parseFixedFloat(eTotal));
	htmlTop += getDrilldownTopButtons(bOnlyTable, title);
	return htmlTop + html;
}

function setScrollerHeight(scroller, elemTop, dyTop) {
	var position = elemTop.offset(); 
	var height = $(window).height() - position.top - dyTop;
	if (height < 100) //minimum size
		height = 100;
	scroller.css("height", height);
}

function makeReportContainer(html, widthWindow, bOnlyTable, elemParent) {
	var container = $(".agile_topLevelTooltipContainer");
	bOnlyTable = bOnlyTable || false;

	if (container.length == 0)
		container = $("<div class='agile_topLevelTooltipContainer'></div>");
	container.html(html);
	var tooltip = null;
	var scroller = container.find(".agile_tooltip_scroller");
	if (!bOnlyTable) {
		tooltip = container.find(".agile_tooltipContainer");
		tooltip.css("width", widthWindow);
		var marginLeft = 0;
		if (widthWindow < $(window).width())
			marginLeft = -Math.round(widthWindow / 2);
		else {
			tooltip.addClass("agile_tooltipContainerAbsolute");
		}
		tooltip.css("margin-left", marginLeft + "px");
	} else {
		setScrollerHeight(scroller, $(".agile_report_container"), 50);
		}

	container.find("tr").click(function () {
		var elemThis = $(this);
		if (elemThis.children("th").length > 0)
			return;
		if (elemThis.hasClass("agile-drilldown-row-toggle"))
			elemThis.removeClass("agile-drilldown-row-toggle");
		else
			elemThis.addClass("agile-drilldown-row-toggle");
	});
	container.hide();
	if (!elemParent)
		elemParent = $('body');
	elemParent.append(container);
	container.show();
	if (true) {
		if (!bOnlyTable)
			scroller.focus();
		function checkRemoveContainer(e) {
			if (e.keyCode == 27)  // esc
				container.remove();
		}

		container.find(".agile_tooltipTable").keyup(checkRemoveContainer);
		if (tooltip)
			tooltip.keyup(checkRemoveContainer);
	}

	var copyWindow = container.find(".agile_drilldown_select");

	if (!bOnlyTable) {
		var header = container.find($(".agile_drilldown_h"));
		header.css("cursor","pointer");
		header.click(function () {
			handleSectionSlide(tooltip, scroller, widthWindow, copyWindow);
		});
		var btnClose = container.find($(".agile_help_close_drilldown"));
		var attrTitle = btnClose.attr("title");
		if (attrTitle)
			return container;
		btnClose.attr("src", chrome.extension.getURL("images/close.png"));
		btnClose.attr("title", "Click or ESC to close.");
		if (btnClose.length > 0) {
			btnClose.click(function () {
				container.remove();
			});
		}
	}

	if (copyWindow.length > 0) {
		var attrTitle = copyWindow.attr("title");
		if (attrTitle)
			return container;
		copyWindow.attr("src", chrome.extension.getURL("images/copy.png"));
		copyWindow.attr("title", "Click to copy table to your clipboard, then paste elsewhere (email, spreadsheet, etc.)");
		copyWindow.click(function () {
			var table = container.find(".agile_tooltip_scroller");
			selectElementContents(table[0]);
		});
	}

	if (!bOnlyTable)
		scroller.scrollview();
	return container;
}

function handleDrilldownWindow(chart, drilldowns, htmlFromRows, colExclude, widthWindow, bReverse) {
	bReverse = bReverse || false;
	var selection = chart.getSelection()[0];
	var html = htmlFromRows(drilldowns[selection.row][selection.column], bReverse, colExclude);
	var container = makeReportContainer(html, widthWindow);
}

function handleSectionSlide(section, content, widthOpen,elemShowHide) {
	var bOpened = (section.hasClass("agile_arrow_opened"));
	if (!bOpened && widthOpen) { //doing width before the toggle looks better and avoids a chrome paint bug
		if (elemShowHide)
			elemShowHide.show();
		section.css("width", widthOpen);
	}
	content.slideToggle(150, function () {
		if (bOpened) {
			section.removeClass("agile_arrow_opened");
			section.addClass("agile_arrow_closed");
			if (elemShowHide)
				elemShowHide.hide();
			section.css("width", "auto");
			section.css("padding-bottom", "0px");
		} else {
			section.removeClass("agile_arrow_closed");
			section.addClass("agile_arrow_opened");
		}
	});
	
}
/**
 * ScrollView - jQuery plugin 0.1
 *
 * from https://code.google.com/p/jquery-scrollview/
 * This plugin supplies contents view by grab and drag scroll.
 *
 * Copyright (c) 2009 Toshimitsu Takahashi
 *
 * Released under the MIT license.
 * 
 * Modified by Zig Mandel
 *
 * == Usage =======================
 *   // apply to block element.
 *   $("#map").scrollview();
 *   
 *   // with setting grab and drag icon urls.
 *   //   grab: the cursor when mouse button is up.
 *   //   grabbing: the cursor when mouse button is down.
 *   //
 *   $("#map".scrollview({
 *	 grab : "images/openhand.cur",
 *	 grabbing : "images/closedhand.cur"
 *   });
 * ================================
 */
if (typeof jQuery !== 'undefined') {
	(function () {
		function ScrollView() { this.initialize.apply(this, arguments); }
		ScrollView.prototype = {
			initialize: function (container, config) {
				// setting cursor.
				var gecko = navigator.userAgent.indexOf("Gecko/") != -1;
				var opera = navigator.userAgent.indexOf("Opera/") != -1;
				var mac = navigator.userAgent.indexOf("Mac OS") != -1;
				if (opera) {
					this.grab = "default";
					this.grabbing = "move";
				} else if (!(mac && gecko) && config) {
					if (config.grab) {
						this.grab = "url(\"" + config.grab + "\"),default";
					}
					if (config.grabbing) {
						this.grabbing = "url(" + config.grabbing + "),move";
					}
				} else if (gecko) {
					this.grab = "-moz-grab";
					this.grabbing = "-moz-grabbing";
				} else {
					this.grab = "default";
					this.grabbing = "ns-resize";
				}

				// Get container and image.
				this.m = $(container);
				this.i = this.m.children().css("cursor", this.grab);

				this.isgrabbing = false;

				// Set mouse events.
				var self = this;
				setTimeout(function () {
					self.i.mousedown(function (e) {
						if (self.isgrabbing) return true;
						self.startgrab();
						self.xp = e.pageX;
						self.yp = e.pageY;
						return false;
					}).mousemove(function (e) {
						if (!self.isgrabbing) return true;
						self.scrollTo(self.xp - e.pageX, self.yp - e.pageY);
						self.xp = e.pageX;
						self.yp = e.pageY;
						return false;
					})
					//.mouseout(function () { self.stopgrab() })
					.mouseup(function () { self.stopgrab(); })
					.dblclick(function () {
						var _m = self.m;
						var off = _m.offset();
						var dy = _m.height() - 11;
						if (dy < 0) {
							dy = "+=" + dy + "px";
						} else {
							dy = "-=" + -dy + "px";
						}
						_m.animate({ scrollLeft: 0, scrollTop: dy },
								"normal", "swing");
					});
					//self.centering();
				}, 50);

			},
			centering: function () {
				var _m = this.m;
				var w = this.i.width() - _m.width();
				var h = this.i.height() - _m.height();
				_m.scrollLeft(w / 2).scrollTop(h / 2);
			},
			startgrab: function () {
				if (this.isgrabbing) return;
				this.isgrabbing = true;
				this.i.css("cursor", this.grabbing);
			},
			stopgrab: function () {
				if (!this.isgrabbing) return;
				this.isgrabbing = false;
				this.i.css("cursor", this.grab);
			},
			scrollTo: function (dx, dy) {
				var _m = this.m;
				var x = _m.scrollLeft() + dx;
				var y = _m.scrollTop() + dy;
				_m.scrollLeft(x).scrollTop(y);
			}
		};

		jQuery.fn.scrollview = function (config) {
			return this.each(function () {
				new ScrollView(this, config);
			});
		};
	})(jQuery);
}


function buildUrlFromParams(doc, params) {
	var url = chrome.extension.getURL(doc);
	var c = 0;
	for (var i in params) {
		var val = params[i];
		if (val == "")
			continue;
		if (c == 0)
			url += "?";
		else
			url += "&";
		url += (i + "=" + encodeURIComponent(val));
		c++;
	}
	return url;
}

function updateUrlState(doc, params) {
	
	window.history.replaceState('data', '', buildUrlFromParams(doc, params));
}

/* cloneObject
 *
 * simple clone for serializable objects
 **/
function cloneObject(obj) {
	return JSON.parse(JSON.stringify(obj));
}


var g_weekNumUse = null;
function getCurrentWeekNum(date) {
	if (date === undefined) {
		if (g_weekNumUse != null)
			return g_weekNumUse;
		date = new Date();
	}
	//verificado que es igual al de gas para 2013-2014
	var weeknum = getWeekNumCalc(date, 0); //week starts at sunday
	var year = date.getFullYear();
	var month = date.getMonth();
	if (weeknum == 1 && month == 11)
		year++; //week  belongs to next year
	else if (month == 0 && weeknum >= 50)
		year--;

	weeknum = getWithZeroPrefix(weeknum);

	//return "2013-W50"; 
	return "" + year + "-W" + weeknum;
}

function getWeekNumCalc(dateIn, dowOffset) {
	//getWeek() was developed by Nick Baicoianu at MeanFreePath: http://www.epoch-calendar.com

	dowOffset = typeof (dowOffset) == 'int' ? dowOffset : 0; //default dowOffset to zero
	var newYear = new Date(dateIn.getFullYear(), 0, 1);
	var day = newYear.getDay() - dowOffset; //the day of week the year begins on
	day = (day >= 0 ? day : day + 7);
	var daynum = Math.floor((dateIn.getTime() - newYear.getTime() -
	(dateIn.getTimezoneOffset() - newYear.getTimezoneOffset()) * 60000) / 86400000) + 1;
	var weeknum;
	//if the year starts before the middle of a week
	if (day < 4) {
		weeknum = Math.floor((daynum + day - 1) / 7) + 1;
		if (weeknum > 52) {
			nYear = new Date(dateIn.getFullYear() + 1, 0, 1);
			nday = nYear.getDay() - dowOffset;
			nday = nday >= 0 ? nday : nday + 7;
			/*if the next year starts before the middle of
 			  the week, it is week #1 of that year*/
			weeknum = nday < 4 ? 1 : 53;
		}
	}
	else {
		weeknum = Math.floor((daynum + day - 1) / 7);
	}
	return weeknum;
}

function getWithZeroPrefix(number) {
	var ret = (number < 10 ? "0" : "") + number;
	return ret;
}

//YYYY-MM-DD 
function makeDateOnlyString(date) {
	return date.getFullYear() + "-" + getWithZeroPrefix(date.getMonth() + 1) + "-" + getWithZeroPrefix(date.getDate());
}

function setBusy(bBusy, elem) {
	if (elem === undefined)
		elem = $("body");
	var classAdd = null;
	var classRem = null;
	if (bBusy) {
		classAdd = "agile_busy";
		classRem = "agile_notbusy";
	} else {
		classAdd = "agile_notbusy";
		classRem = "agile_busy";
	}
	setTimeout(function () {
		elem.removeClass(classRem);
		elem.addClass(classAdd);
	}, 50);
}
