FROM timberio/vector:$$cap_vector_version
__WRITE_VECTOR_CONFIG__
CMD ["--config", "/etc/vector/vector.yml"]
