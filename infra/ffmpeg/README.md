# FFmpeg Recording Configuration
#
# This directory contains FFmpeg-related configuration for server-side recording.
# Recording is implemented in Phase 4.
#
# WHY server-side recording?
# - Client-side recording can be tampered with
# - Browser crashes lose recording
# - Server has better storage and redundancy
#
# ARCHITECTURE:
# - mediasoup PlainTransport sends RTP to FFmpeg
# - FFmpeg records to files
# - Files are stored and later processed

# Placeholder for FFmpeg configuration
# Actual implementation in Phase 4
